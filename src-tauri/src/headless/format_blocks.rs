//! Turn CLI content blocks (tool_use / thinking / text) into Chat markdown fences.

use serde_json::Value;

const MAX_DETAIL: usize = 2_500;

/// Flatten a message `content` value (string or block array) for Chat history / display.
pub fn content_to_chat_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut parts = Vec::new();
            for v in arr {
                match v {
                    Value::String(s) if !s.is_empty() => parts.push(s.clone()),
                    Value::Object(_) => {
                        if let Some(block) = format_content_block(v) {
                            parts.push(block);
                        }
                    }
                    _ => {}
                }
            }
            parts.join("\n\n")
        }
        Value::Object(map) => {
            if let Some(Value::String(t)) = map.get("text") {
                return t.clone();
            }
            format_content_block(content).unwrap_or_default()
        }
        _ => String::new(),
    }
}

fn format_content_block(v: &Value) -> Option<String> {
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "text" => v
            .get("text")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        "thinking" | "reasoning" => {
            let th = v
                .get("thinking")
                .or_else(|| v.get("text"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim();
            if th.is_empty() {
                None
            } else {
                Some(format!(
                    "```thinking\n{}\n```",
                    truncate_chars(th, MAX_DETAIL)
                ))
            }
        }
        "tool_use" | "tool-call" | "tool_call" => {
            let name = v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("tool");
            let input = v
                .get("input")
                .or_else(|| v.get("arguments"))
                .or_else(|| v.get("args"))
                .cloned()
                .unwrap_or(Value::Null);
            Some(format_tool_use(name, &input))
        }
        "tool_result" | "tool-result" => {
            let body = tool_result_body(v);
            if body.trim().is_empty() {
                return None;
            }
            let err = v
                .get("is_error")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            let tag = if err { "tool-error" } else { "tool-result" };
            Some(format!(
                "```{tag}\n{}\n```",
                truncate_chars(body.trim(), MAX_DETAIL)
            ))
        }
        // Skip opaque / redacted control blocks.
        "redacted_thinking" => None,
        _ => {
            // Unknown block with text still useful.
            v.get("text")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        }
    }
}

pub fn format_tool_use(name: &str, input: &Value) -> String {
    let headline = tool_headline(name, input);
    let detail = tool_detail(name, input);
    let mut out = format!("```tool\n{headline}");
    if !detail.is_empty() {
        out.push('\n');
        out.push_str(&detail);
    }
    out.push_str("\n```");
    out
}

fn tool_headline(name: &str, input: &Value) -> String {
    let n = name.trim();
    let lower = n.to_ascii_lowercase();
    match lower.as_str() {
        "read" | "readfile" | "read_file" => {
            let path = arg_str(input, &["path", "filePath", "target_file"]).unwrap_or_default();
            let offset = arg_u64(input, &["offset"]);
            let limit = arg_u64(input, &["limit"]);
            match (offset, limit) {
                (Some(o), Some(l)) => {
                    format!("Read {path} lines {}-{}", o, o + l.saturating_sub(1))
                }
                (Some(o), None) => format!("Read {path} from line {o}"),
                _ => format!("Read {path}"),
            }
        }
        "grep" | "rg" | "search" => {
            let pat = arg_str(input, &["pattern", "regex", "query"]).unwrap_or_default();
            let path =
                arg_str(input, &["path", "glob", "targetDirectory"]).unwrap_or_else(|| ".".into());
            format!("Grep \"{pat}\" in {path}")
        }
        "glob" | "findall" => {
            let pat = arg_str(input, &["glob_pattern", "globPattern", "glob", "pattern"])
                .unwrap_or_default();
            let dir = arg_str(input, &["target_directory", "targetDirectory", "path"])
                .unwrap_or_else(|| ".".into());
            format!("Glob \"{pat}\" in {dir}")
        }
        "shell" | "bash" | "run_terminal_cmd" | "powershell" => {
            let cmd = arg_str(input, &["command", "cmd"]).unwrap_or_default();
            format!("Shell {cmd}")
        }
        "write" | "writefile" | "write_file" => {
            let path = arg_str(input, &["path", "filePath", "target_file"]).unwrap_or_default();
            format!("Write {path}")
        }
        "streplace" | "str_replace" | "streditor" | "edit" | "apply_patch" => {
            let path = arg_str(input, &["path", "filePath", "target_file"]).unwrap_or_default();
            format!("Edit {path}")
        }
        "websearch" | "web_search" => {
            let q = arg_str(input, &["search_term", "query", "q"]).unwrap_or_default();
            format!("WebSearch {q}")
        }
        "webfetch" | "web_fetch" | "fetch" => {
            let url = arg_str(input, &["url"]).unwrap_or_default();
            format!("WebFetch {url}")
        }
        "todowrite" | "todo_write" | "updatetodos" => {
            let n = input
                .get("todos")
                .and_then(|t| t.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            format!("Todo · {n} item{}", if n == 1 { "" } else { "s" })
        }
        "getdynamictools" | "calldynamictool" => {
            let ns = arg_str(input, &["namespace", "server"]).unwrap_or_default();
            let tool = arg_str(input, &["toolName", "tool", "name"]).unwrap_or_default();
            let pattern = arg_str(input, &["pattern"]).unwrap_or_default();
            if !tool.is_empty() {
                if ns.is_empty() {
                    format!("MCP {tool}")
                } else {
                    format!("MCP {ns} · {tool}")
                }
            } else if !pattern.is_empty() {
                format!("MCP search \"{pattern}\"")
            } else if !ns.is_empty() {
                format!("MCP {ns}")
            } else {
                n.to_string()
            }
        }
        _ => {
            // Keep original name; append a short path/query hint when present.
            if let Some(path) = arg_str(input, &["path", "filePath", "target_file"]) {
                format!("{n} {path}")
            } else if let Some(q) = arg_str(input, &["pattern", "query", "search_term", "command"])
            {
                format!("{n} {q}")
            } else {
                n.to_string()
            }
        }
    }
}

fn tool_detail(name: &str, input: &Value) -> String {
    let lower = name.trim().to_ascii_lowercase();
    match lower.as_str() {
        "todowrite" | "todo_write" | "updatetodos" => format_todos(input.get("todos")),
        "write" | "writefile" | "write_file" => arg_str(input, &["contents", "content", "fileText"])
            .map(|s| truncate_chars(&s, 800))
            .unwrap_or_default(),
        "streplace" | "str_replace" | "edit" => {
            let mut parts = Vec::new();
            if let Some(old) = arg_str(input, &["old_string", "oldString"]) {
                parts.push(format!("- {}", truncate_chars(&old, 400)));
            }
            if let Some(new) = arg_str(input, &["new_string", "newString"]) {
                parts.push(format!("+ {}", truncate_chars(&new, 400)));
            }
            parts.join("\n")
        }
        "calldynamictool" | "getdynamictools" => {
            if let Some(a) = input.get("arguments") {
                if !a.is_null() {
                    return truncate_chars(
                        &serde_json::to_string_pretty(a).unwrap_or_default(),
                        1_200,
                    );
                }
            }
            String::new()
        }
        _ => {
            // For unfamiliar tools, show compact JSON when small enough.
            if input.is_null() || input.as_object().map(|o| o.is_empty()).unwrap_or(false) {
                return String::new();
            }
            // Avoid dumping huge payloads for Read/Grep (headline is enough).
            if matches!(
                lower.as_str(),
                "read"
                    | "grep"
                    | "glob"
                    | "shell"
                    | "bash"
                    | "websearch"
                    | "webfetch"
            ) {
                return String::new();
            }
            let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
            if pretty.len() > 1_200 {
                String::new()
            } else {
                pretty
            }
        }
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
        let status = t.get("status").and_then(|x| x.as_str()).unwrap_or("");
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

fn tool_result_body(item: &Value) -> String {
    match item.get("content") {
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
        None => String::new(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn formats_read_and_grep_blocks() {
        let content = json!([
            {"type":"text","text":"Looking around."},
            {"type":"tool_use","name":"Read","input":{"path":"src/App.tsx","offset":10,"limit":20}},
            {"type":"tool_use","name":"Grep","input":{"pattern":"setBusy","path":"src"}},
        ]);
        let s = content_to_chat_text(&content);
        assert!(s.contains("Looking around."));
        assert!(s.contains("```tool"));
        assert!(s.contains("Read src/App.tsx"));
        assert!(s.contains("Grep \"setBusy\""));
    }

    #[test]
    fn formats_mcp_and_todo() {
        let content = json!([
            {"type":"tool_use","name":"GetDynamicTools","input":{"namespace":"cursor","toolName":"TodoWrite"}},
            {"type":"tool_use","name":"TodoWrite","input":{"todos":[
                {"content":"Fix history","status":"completed"},
                {"content":"Ship it","status":"pending"}
            ]}},
        ]);
        let s = content_to_chat_text(&content);
        assert!(s.contains("MCP cursor · TodoWrite"));
        assert!(s.contains("✔ Fix history"));
        assert!(s.contains("○ Ship it"));
    }
}
