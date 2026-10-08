//! Extract visible assistant text deltas from CLI stream-json / JSONL lines.

use serde_json::Value;

const MAX_RESULT_CHARS: usize = 2_500;

/// Returns text to append to the Chat bubble for one stdout line (or chunk).
/// `json_mode`: prefer structured extraction; skip opaque control lines.
pub fn visible_delta(cli_id: &str, json_mode: bool, piece: &str) -> Option<String> {
    let trimmed = piece.trim();
    if trimmed.is_empty() {
        return None;
    }
    if json_mode || trimmed.starts_with('{') {
        return extract_json_delta(cli_id, trimmed);
    }
    // Plain text stream: pass through (strip ANSI-ish noise lightly later if needed).
    Some(piece.to_string())
}

fn extract_json_delta(cli_id: &str, line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    if let Some(s) = delta_from_value(cli_id, &v) {
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

fn delta_from_value(cli_id: &str, v: &Value) -> Option<String> {
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

    // Claude `--include-partial-messages`: {"type":"stream_event","event":{...}}
    if ty == "stream_event" {
        if let Some(event) = v.get("event") {
            return delta_from_value(cli_id, event);
        }
        return None;
    }

    // Cursor agent: tool_call started/completed (Read / Grep / Todo / MCP / …).
    if ty == "tool_call" {
        return cursor_tool_call(v);
    }

    // Skip Cursor terminal result — text already streamed via assistant / tools.
    if ty == "result" {
        return None;
    }

    // Claude / Anthropic stream events (possibly nested under stream_event).
    // Tool headers come from completed assistant frames (not block_start) so we
    // do not leave an unclosed ```tool fence while JSON streams in.
    if ty == "content_block_delta" || v.get("delta").is_some() {
        if let Some(s) = claude_block_delta(v) {
            return Some(s);
        }
    }

    // Claude full frames: tool_use / thinking / tool_result (text already streamed).
    if cli_id == "claude" {
        if ty == "assistant" {
            return claude_assistant_extras(v);
        }
        if ty == "user" {
            return claude_tool_results(v);
        }
    }

    // Cursor / shared assistant message text.
    if ty == "assistant" {
        if cli_id == "cursor" && !cursor_assistant_is_new_text(v) {
            return None;
        }
        if let Some(t) = v
            .pointer("/message/content")
            .and_then(content_to_plain_text)
            .filter(|s| !s.is_empty())
        {
            return Some(t);
        }
    }

    // Cursor agent partial / text events
    if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
        if ty.contains("delta")
            || ty.contains("text")
            || ty.contains("message")
            || ty.is_empty()
            || cli_id == "cursor"
        {
            if t.len() < 8_000 {
                return Some(t.to_string());
            }
        }
    }
    if ty != "assistant" && ty != "user" {
        if let Some(t) = v.pointer("/message/content").and_then(content_to_plain_text) {
            return Some(t);
        }
    }
    if let Some(t) = v.pointer("/part/text").and_then(|x| x.as_str()) {
        return Some(t.to_string());
    }
    if let Some(t) = v.get("content").and_then(|x| x.as_str()) {
        return Some(t.to_string());
    }
    None
}

/// With `--stream-partial-output`: only timestamp_ms present + no model_call_id
/// carries new text. Other assistant flushes are duplicates.
fn cursor_assistant_is_new_text(v: &Value) -> bool {
    v.get("timestamp_ms").is_some() && v.get("model_call_id").is_none()
}

fn cursor_tool_call(v: &Value) -> Option<String> {
    let subtype = v.get("subtype").and_then(|x| x.as_str()).unwrap_or("");
    let tool_call = v.get("tool_call")?.as_object()?;

    // Prefer first concrete *ToolCall / function entry.
    for (key, body) in tool_call {
        if matches!(
            key.as_str(),
            "hookAdditionalContexts" | "toolCallId" | "startedAtMs" | "completedAtMs"
        ) {
            continue;
        }
        if key == "function" {
            return cursor_function_tool(subtype, body);
        }
        return Some(format_cursor_named_tool(subtype, key, body));
    }
    None
}

fn cursor_function_tool(subtype: &str, body: &Value) -> Option<String> {
    let name = body
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("tool");
    let args = body
        .get("arguments")
        .cloned()
        .unwrap_or(Value::Null);
    let args_txt = match &args {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    };
    if subtype == "completed" {
        let mut out = format!("\n\n```tool-result\n{name} done\n");
        if let Some(r) = body.get("result") {
            out.push_str(&truncate_chars(
                &serde_json::to_string_pretty(r).unwrap_or_default(),
                MAX_RESULT_CHARS,
            ));
            out.push('\n');
        }
        out.push_str("```\n");
        return Some(out);
    }
    let mut out = format!("\n\n```tool\n{name}\n");
    if !args_txt.trim().is_empty() && args_txt != "null" {
        out.push_str(&truncate_chars(&args_txt, MAX_RESULT_CHARS));
        out.push('\n');
    }
    out.push_str("```\n");
    Some(out)
}

fn format_cursor_named_tool(subtype: &str, key: &str, body: &Value) -> String {
    let label = cursor_tool_label(key);
    let args = body.get("args").unwrap_or(&Value::Null);

    if subtype == "completed" {
        let mut out = format!("\n\n```tool-result\n{label}");
        let summary = cursor_result_summary(key, body);
        if !summary.is_empty() {
            out.push(' ');
            out.push_str(&summary);
        }
        out.push('\n');
        if let Some(preview) = cursor_result_preview(key, body) {
            out.push_str(&preview);
            out.push('\n');
        }
        out.push_str("```\n");
        return out;
    }

    // started (default): show human-readable one-liner + compact args
    let mut out = format!("\n\n```tool\n{}", cursor_started_line(label, key, args));
    let detail = cursor_started_detail(key, args);
    if !detail.is_empty() {
        out.push('\n');
        out.push_str(&detail);
    }
    out.push_str("\n```\n");
    out
}

fn cursor_tool_label(key: &str) -> &'static str {
    match key {
        "readToolCall" => "Read",
        "writeToolCall" => "Write",
        "editToolCall" | "strReplaceToolCall" => "Edit",
        "deleteToolCall" => "Delete",
        "shellToolCall" | "bashToolCall" => "Shell",
        "grepToolCall" => "Grep",
        "globToolCall" => "Glob",
        "lsToolCall" => "LS",
        "todoToolCall" | "updateTodosToolCall" => "Todo",
        "mcpToolCall" | "callMcpTool" => "MCP",
        "awaitToolCall" => "Await",
        "semanticSearchToolCall" => "Search",
        "webSearchToolCall" | "webFetchToolCall" => "Web",
        _ => "Tool",
    }
}

fn cursor_started_line(label: &str, key: &str, args: &Value) -> String {
    match key {
        "readToolCall" => {
            let path = arg_str(args, &["path", "filePath", "target_file"]).unwrap_or_default();
            let offset = arg_u64(args, &["offset"]);
            let limit = arg_u64(args, &["limit"]);
            match (offset, limit) {
                (Some(o), Some(l)) => format!("{label} {path} lines {}-{}", o, o + l.saturating_sub(1)),
                (Some(o), None) => format!("{label} {path} from line {o}"),
                _ => format!("{label} {path}"),
            }
        }
        "grepToolCall" => {
            let pat = arg_str(args, &["pattern", "regex"]).unwrap_or_default();
            let path = arg_str(args, &["path", "glob", "targetDirectory"]).unwrap_or_else(|| ".".into());
            format!("{label} \"{pat}\" in {path}")
        }
        "globToolCall" => {
            let pat = arg_str(args, &["globPattern", "glob", "pattern"]).unwrap_or_default();
            let dir = arg_str(args, &["targetDirectory", "path"]).unwrap_or_else(|| ".".into());
            format!("{label} \"{pat}\" in {dir}")
        }
        "lsToolCall" => {
            let path = arg_str(args, &["path"]).unwrap_or_else(|| ".".into());
            format!("{label} {path}")
        }
        "shellToolCall" | "bashToolCall" => {
            let cmd = arg_str(args, &["command", "cmd"]).unwrap_or_default();
            format!("{label} {cmd}")
        }
        "writeToolCall" | "editToolCall" | "strReplaceToolCall" | "deleteToolCall" => {
            let path = arg_str(args, &["path", "filePath", "target_file"]).unwrap_or_default();
            format!("{label} {path}")
        }
        "todoToolCall" | "updateTodosToolCall" => {
            let n = args
                .get("todos")
                .and_then(|t| t.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let merge = args
                .get("merge")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            format!(
                "{label} {} · {n} item{}",
                if merge { "merge" } else { "update" },
                if n == 1 { "" } else { "s" }
            )
        }
        "mcpToolCall" | "callMcpTool" => {
            let server = arg_str(args, &["server", "mcpServer", "namespace"]).unwrap_or_default();
            let tool = arg_str(args, &["toolName", "tool", "name"]).unwrap_or_default();
            if server.is_empty() {
                format!("{label} {tool}")
            } else {
                format!("{label} {server} · {tool}")
            }
        }
        "webSearchToolCall" => {
            let q = arg_str(args, &["search_term", "query", "q"]).unwrap_or_default();
            format!("{label} {q}")
        }
        "webFetchToolCall" => {
            let url = arg_str(args, &["url"]).unwrap_or_default();
            format!("{label} {url}")
        }
        _ => {
            if let Some(name) = arg_str(args, &["name", "toolName"]) {
                format!("{label} {name}")
            } else {
                label.to_string()
            }
        }
    }
}

fn cursor_started_detail(key: &str, args: &Value) -> String {
    match key {
        "todoToolCall" | "updateTodosToolCall" => format_todos(args.get("todos")),
        "writeToolCall" => {
            if let Some(text) = arg_str(args, &["fileText", "contents", "content"]) {
                truncate_chars(&text, 800)
            } else {
                String::new()
            }
        }
        "editToolCall" | "strReplaceToolCall" => {
            let mut parts = Vec::new();
            if let Some(old) = arg_str(args, &["old_string", "oldString"]) {
                parts.push(format!("- {}", truncate_chars(&old, 400)));
            }
            if let Some(new) = arg_str(args, &["new_string", "newString"]) {
                parts.push(format!("+ {}", truncate_chars(&new, 400)));
            }
            parts.join("\n")
        }
        "mcpToolCall" | "callMcpTool" => {
            if let Some(a) = args.get("arguments").or_else(|| args.get("args")) {
                if !a.is_null() {
                    return truncate_chars(
                        &serde_json::to_string_pretty(a).unwrap_or_default(),
                        1_200,
                    );
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn format_todos(todos: Option<&Value>) -> String {
    let Some(arr) = todos.and_then(|t| t.as_array()) else {
        return String::new();
    };
    let mut lines = Vec::new();
    for t in arr {
        let content = t
            .get("content")
            .or_else(|| t.get("text"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim();
        if content.is_empty() {
            continue;
        }
        let status = t
            .get("status")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let mark = match status {
            "TODO_STATUS_COMPLETED" | "completed" | "done" => "✔",
            "TODO_STATUS_IN_PROGRESS" | "in_progress" | "in-progress" => "◐",
            "TODO_STATUS_CANCELLED" | "cancelled" | "canceled" => "✗",
            _ => "○",
        };
        lines.push(format!("{mark} {content}"));
    }
    lines.join("\n")
}

fn cursor_result_summary(key: &str, body: &Value) -> String {
    let success = body.pointer("/result/success");
    match key {
        "readToolCall" => {
            let lines = success
                .and_then(|s| s.get("totalLines").or_else(|| s.get("total_lines")))
                .and_then(|x| x.as_u64());
            match lines {
                Some(n) => format!("· {n} lines"),
                None => String::new(),
            }
        }
        "grepToolCall" => {
            let n = success
                .and_then(|s| {
                    s.get("workspaceResults")
                        .or_else(|| s.get("matches"))
                        .or_else(|| s.get("content"))
                })
                .map(|v| match v {
                    Value::Array(a) => a.len(),
                    Value::Object(m) => m.len(),
                    Value::String(s) => s.lines().count(),
                    _ => 0,
                })
                .unwrap_or(0);
            if n > 0 {
                format!("· {n} hits")
            } else {
                String::new()
            }
        }
        "shellToolCall" | "bashToolCall" => {
            let code = success
                .and_then(|s| s.get("exitCode").or_else(|| s.get("exit_code")))
                .and_then(|x| x.as_i64());
            match code {
                Some(0) => "· ok".into(),
                Some(c) => format!("· exit {c}"),
                None => String::new(),
            }
        }
        "writeToolCall" | "editToolCall" => {
            let lines = success
                .and_then(|s| {
                    s.get("linesCreated")
                        .or_else(|| s.get("lines"))
                        .or_else(|| s.get("totalLines"))
                })
                .and_then(|x| x.as_u64());
            match lines {
                Some(n) => format!("· {n} lines"),
                None => "· done".into(),
            }
        }
        _ => {
            if body.pointer("/result/success").is_some() {
                "· done".into()
            } else if body.pointer("/result/error").is_some()
                || body.pointer("/result/failure").is_some()
            {
                "· error".into()
            } else {
                String::new()
            }
        }
    }
}

fn cursor_result_preview(key: &str, body: &Value) -> Option<String> {
    let success = body.pointer("/result/success")?;
    match key {
        "readToolCall" => {
            let content = success.get("content")?.as_str()?;
            Some(truncate_chars(content, MAX_RESULT_CHARS))
        }
        "shellToolCall" | "bashToolCall" => {
            let out = success
                .get("stdout")
                .or_else(|| success.get("output"))
                .or_else(|| success.get("fullOutput"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let err = success
                .get("stderr")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let mut s = String::new();
            if !out.is_empty() {
                s.push_str(out);
            }
            if !err.is_empty() {
                if !s.is_empty() {
                    s.push('\n');
                }
                s.push_str(err);
            }
            if s.is_empty() {
                None
            } else {
                Some(truncate_chars(&s, MAX_RESULT_CHARS))
            }
        }
        "grepToolCall" => {
            // Prefer compact listing over dumping whole workspaceResults blob.
            if let Some(s) = success.get("content").and_then(|x| x.as_str()) {
                return Some(truncate_chars(s, MAX_RESULT_CHARS));
            }
            None
        }
        _ => None,
    }
}

fn arg_str(args: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = args.get(*k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn arg_u64(args: &Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = args.get(*k).and_then(|x| x.as_u64()) {
            return Some(n);
        }
    }
    None
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let trimmed: String = s.chars().take(max).collect();
    format!("{trimmed}\n… truncated")
}

fn claude_block_delta(v: &Value) -> Option<String> {
    let delta = v.get("delta")?;
    let dty = delta.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match dty {
        "text_delta" => delta
            .get("text")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        // Prefer completed assistant thinking block (fenced) over raw deltas.
        "thinking_delta" => None,
        // Skip char-by-char tool JSON — full input arrives on assistant tool_use.
        "input_json_delta" => None,
        _ => delta
            .get("text")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
    }
}

/// tool_use / thinking from completed assistant frames (skip pure text — already streamed).
fn claude_assistant_extras(v: &Value) -> Option<String> {
    let arr = v.pointer("/message/content")?.as_array()?;
    let mut out = String::new();
    for item in arr {
        let t = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "tool_use" => {
                let name = item
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("tool");
                let input = item.get("input").cloned().unwrap_or(Value::Null);
                let pretty =
                    serde_json::to_string_pretty(&input).unwrap_or_else(|_| "{}".into());
                out.push_str("\n\n```tool\n");
                out.push_str(name);
                out.push('\n');
                out.push_str(&pretty);
                out.push_str("\n```\n");
            }
            "thinking" => {
                let th = item
                    .get("thinking")
                    .or_else(|| item.get("text"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .trim();
                if !th.is_empty() {
                    out.push_str("\n\n```thinking\n");
                    out.push_str(th);
                    out.push_str("\n```\n");
                }
            }
            "text" => {}
            _ => {}
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn claude_tool_results(v: &Value) -> Option<String> {
    let arr = v.pointer("/message/content")?.as_array()?;
    let mut out = String::new();
    for item in arr {
        if item.get("type").and_then(|x| x.as_str()) != Some("tool_result") {
            continue;
        }
        let body = match item.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(parts)) => {
                let mut s = String::new();
                for p in parts {
                    if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
                        s.push_str(t);
                    } else if let Some(t) = p.as_str() {
                        s.push_str(t);
                    }
                }
                s
            }
            Some(other) => other.to_string(),
            None => continue,
        };
        let err = item
            .get("is_error")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let tag = if err { "tool-error" } else { "tool-result" };
        out.push_str(&format!("\n\n```{tag}\n"));
        out.push_str(&truncate_chars(body.trim(), MAX_RESULT_CHARS));
        out.push_str("\n```\n");
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn content_to_plain_text(c: &Value) -> Option<String> {
    match c {
        Value::String(s) => Some(s.clone()),
        Value::Array(arr) => {
            let mut out = String::new();
            for item in arr {
                if let Some(s) = item.get("text").and_then(|x| x.as_str()) {
                    out.push_str(s);
                } else if let Some(s) = item.as_str() {
                    out.push_str(s);
                }
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_text_delta() {
        let line = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}"#;
        assert_eq!(
            visible_delta("claude", true, line).as_deref(),
            Some("Hello")
        );
    }

    #[test]
    fn claude_stream_event_wrapper() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}"#;
        assert_eq!(
            visible_delta("claude", true, line).as_deref(),
            Some("Hi")
        );
    }

    #[test]
    fn claude_skips_text_only_assistant_blob() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}}"#;
        assert!(visible_delta("claude", true, line).is_none());
    }

    #[test]
    fn claude_emits_tool_use_from_assistant() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo hi"}}]}}"#;
        let s = visible_delta("claude", true, line).unwrap();
        assert!(s.contains("Bash"));
        assert!(s.contains("echo hi"));
    }

    #[test]
    fn claude_emits_tool_result() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"hello-from-sema","is_error":false}]}}"#;
        let s = visible_delta("claude", true, line).unwrap();
        assert!(s.contains("hello-from-sema"));
        assert!(s.contains("tool-result"));
    }

    #[test]
    fn plain_passthrough() {
        assert_eq!(
            visible_delta("gemini", false, "hi\n").as_deref(),
            Some("hi\n")
        );
    }

    #[test]
    fn skips_empty_json() {
        assert!(visible_delta("claude", true, r#"{"type":"ping"}"#).is_none());
    }

    #[test]
    fn cursor_tool_call_read_started() {
        let line = r#"{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"src/App.tsx","offset":530,"limit":50}}}}"#;
        let s = visible_delta("cursor", true, line).unwrap();
        assert!(s.contains("```tool"));
        assert!(s.contains("Read src/App.tsx"));
        assert!(s.contains("530"));
    }

    #[test]
    fn cursor_tool_call_grep_started() {
        let line = r#"{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"grepToolCall":{"args":{"pattern":"setBusy","path":"src"}}}}"#;
        let s = visible_delta("cursor", true, line).unwrap();
        assert!(s.contains("Grep"));
        assert!(s.contains("setBusy"));
    }

    #[test]
    fn cursor_tool_call_todo_started() {
        let line = r#"{"type":"tool_call","subtype":"started","call_id":"c3","tool_call":{"todoToolCall":{"args":{"merge":true,"todos":[{"content":"Fix pulse","status":"TODO_STATUS_IN_PROGRESS"},{"content":"Done item","status":"TODO_STATUS_COMPLETED"}]}}}}"#;
        let s = visible_delta("cursor", true, line).unwrap();
        assert!(s.contains("Todo"));
        assert!(s.contains("Fix pulse"));
        assert!(s.contains("✔"));
        assert!(s.contains("◐"));
    }

    #[test]
    fn cursor_tool_call_completed_read() {
        let line = r#"{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"a.rs"},"result":{"success":{"content":"fn main() {}","totalLines":1}}}}}"#;
        let s = visible_delta("cursor", true, line).unwrap();
        assert!(s.contains("tool-result"));
        assert!(s.contains("fn main"));
        assert!(s.contains("1 lines"));
    }

    #[test]
    fn cursor_skips_duplicate_assistant_flush() {
        let dup = r#"{"type":"assistant","timestamp_ms":1,"model_call_id":"m1","message":{"content":[{"type":"text","text":"dup"}]}}"#;
        assert!(visible_delta("cursor", true, dup).is_none());
        let final_flush = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"final"}]}}"#;
        assert!(visible_delta("cursor", true, final_flush).is_none());
        let fresh = r#"{"type":"assistant","timestamp_ms":2,"message":{"content":[{"type":"text","text":"hi"}]}}"#;
        assert_eq!(
            visible_delta("cursor", true, fresh).as_deref(),
            Some("hi")
        );
    }

    #[test]
    fn cursor_skips_result_event() {
        let line = r#"{"type":"result","subtype":"success","result":"all done"}"#;
        assert!(visible_delta("cursor", true, line).is_none());
    }

    #[test]
    fn cursor_mcp_tool() {
        let line = r#"{"type":"tool_call","subtype":"started","call_id":"c4","tool_call":{"mcpToolCall":{"args":{"server":"cursor","toolName":"TodoWrite","arguments":{"merge":true}}}}}"#;
        let s = visible_delta("cursor", true, line).unwrap();
        assert!(s.contains("MCP"));
        assert!(s.contains("TodoWrite"));
    }
}
