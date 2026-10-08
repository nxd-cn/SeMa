//! Load prior user/assistant turns from on-disk CLI session stores (read-only).
//! Used by Chat UI after resume so history is visible before the next send.

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rusqlite::{params, types::Value as SqlValue, Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;

use crate::artifacts::{
    claude::find_claude_jsonl, codex::find_codex_jsonl, cursor::find_cursor_store_db,
    cursor::open_store_readonly, gemini::find_gemini_file, opencode::opencode_db_path,
    pi::find_pi_jsonl,
};
use crate::headless::format_blocks::content_to_chat_text;
use crate::platform::home_dir;
use crate::resume::{find_kimi_session_dir, list_session_ids};

const MAX_MESSAGES: usize = 100;
const MAX_TEXT_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryMessage {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryResult {
    pub session_id: Option<String>,
    pub messages: Vec<ChatHistoryMessage>,
}

pub fn load_chat_history(
    cli_id: &str,
    cwd: &str,
    session_id: Option<&str>,
    home: Option<&Path>,
) -> ChatHistoryResult {
    let mut sid = session_id.map(str::trim).unwrap_or("").to_string();
    if sid.is_empty() {
        sid = list_session_ids(cli_id, cwd, home)
            .into_iter()
            .max_by(|a, b| {
                a.mtime_ms
                    .partial_cmp(&b.mtime_ms)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|e| e.id)
            .unwrap_or_default();
    }
    if sid.is_empty() {
        return ChatHistoryResult::default();
    }

    let mut messages = match cli_id {
        "claude" => history_claude(cwd, &sid, home),
        "cursor" => history_cursor(cwd, &sid, home),
        "opencode" => history_opencode(&sid, home),
        "pi" => history_jsonl_file(find_pi_jsonl(cwd, &sid, home).as_deref()),
        "codex" => history_jsonl_file(find_codex_jsonl(&sid, home).as_deref()),
        "gemini" => history_gemini(cwd, &sid, home),
        "kimi" => history_kimi(cwd, &sid, home),
        _ => Vec::new(),
    };

    messages = merge_consecutive_assistants(messages);
    if messages.len() > MAX_MESSAGES {
        messages = messages.split_off(messages.len() - MAX_MESSAGES);
    }

    ChatHistoryResult {
        session_id: Some(sid),
        messages,
    }
}

fn history_claude(cwd: &str, session_id: &str, home: Option<&Path>) -> Vec<ChatHistoryMessage> {
    let Some(path) = find_claude_jsonl(cwd, session_id, home) else {
        return Vec::new();
    };
    messages_from_jsonl_lines(&path, |v| {
        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if ty != "user" && ty != "assistant" {
            return None;
        }
        let content = v
            .pointer("/message/content")
            .or_else(|| v.get("content"))?;
        let text = content_to_chat_text(content);
        if text.trim().is_empty() {
            return None;
        }
        Some(ChatHistoryMessage {
            role: ty.to_string(),
            text: truncate_text(text),
        })
    })
}

fn history_cursor(cwd: &str, session_id: &str, home: Option<&Path>) -> Vec<ChatHistoryMessage> {
    // Prefer agent-transcripts JSONL ? includes tool_use blocks (store.db often
    // strips or redacts them for IDE blobs).
    let from_transcript = history_cursor_agent_transcript(session_id, home);
    if !from_transcript.is_empty() {
        return from_transcript;
    }
    history_cursor_store_db(cwd, session_id, home)
}

/// `~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl`
fn history_cursor_agent_transcript(
    session_id: &str,
    home: Option<&Path>,
) -> Vec<ChatHistoryMessage> {
    let Some(path) = find_cursor_agent_transcript(session_id, home) else {
        return Vec::new();
    };
    messages_from_jsonl_lines(&path, |v| {
        let role = v.get("role").and_then(|x| x.as_str()).unwrap_or("");
        if role != "user" && role != "assistant" {
            return None;
        }
        let content = v
            .pointer("/message/content")
            .or_else(|| v.get("content"))?;
        let mut text = content_to_chat_text(content);
        if role == "user" {
            if let Some(q) = extract_user_query(&text) {
                text = q;
            } else if looks_like_meta_user_blob(&text) {
                return None;
            }
        }
        if text.trim().is_empty() {
            return None;
        }
        Some(ChatHistoryMessage {
            role: role.to_string(),
            text: truncate_text(text),
        })
    })
}

fn find_cursor_agent_transcript(session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let sid = session_id.trim();
    if sid.is_empty() || sid.contains('/') || sid.contains('\\') || sid.contains("..") {
        return None;
    }
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let projects = home.join(".cursor").join("projects");
    if !projects.is_dir() {
        return None;
    }
    let Ok(entries) = fs::read_dir(&projects) else {
        return None;
    };
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    for e in entries.flatten() {
        let base = e
            .path()
            .join("agent-transcripts")
            .join(sid)
            .join(format!("{sid}.jsonl"));
        // Also accept flat layout: agent-transcripts/<sid>.jsonl
        let flat = e.path().join("agent-transcripts").join(format!("{sid}.jsonl"));
        for cand in [base, flat] {
            if !cand.is_file() {
                continue;
            }
            let mtime = fs::metadata(&cand)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            match &best {
                Some((_, t)) if *t >= mtime => {}
                _ => best = Some((cand, mtime)),
            }
        }
    }
    best.map(|(p, _)| p)
}

fn history_cursor_store_db(
    cwd: &str,
    session_id: &str,
    home: Option<&Path>,
) -> Vec<ChatHistoryMessage> {
    let Some(path) = find_cursor_store_db(cwd, session_id, home) else {
        return Vec::new();
    };
    let Some(conn) = open_store_readonly(&path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare("SELECT data FROM blobs ORDER BY rowid ASC") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let data: Vec<u8> = row.get(0)?;
        Ok(data)
    }) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for data in rows.flatten() {
        let Ok(s) = std::str::from_utf8(&data) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(s) else {
            continue;
        };
        let role = v.get("role").and_then(|x| x.as_str()).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let Some(content) = v
            .get("content")
            .or_else(|| v.pointer("/message/content"))
        else {
            continue;
        };
        let mut text = content_to_chat_text(content);
        if role == "user" {
            if let Some(q) = extract_user_query(&text) {
                text = q;
            } else if looks_like_meta_user_blob(&text) {
                continue;
            }
        }
        if role == "assistant" && text.trim().is_empty() {
            continue;
        }
        if text.trim().is_empty() {
            continue;
        }
        out.push(ChatHistoryMessage {
            role: role.to_string(),
            text: truncate_text(text),
        });
    }
    out
}

fn history_opencode(session_id: &str, home: Option<&Path>) -> Vec<ChatHistoryMessage> {
    let db_path = opencode_db_path(home);
    if !db_path.is_file() {
        return Vec::new();
    }
    let Ok(conn) = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };

    let Ok(mut msg_stmt) = conn.prepare(
        "SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created ASC",
    ) else {
        return Vec::new();
    };
    let Ok(msg_rows) = msg_stmt.query_map(params![session_id], |row| {
        let id: String = row.get(0)?;
        let data: String = match row.get::<_, SqlValue>(1)? {
            SqlValue::Text(t) => t,
            SqlValue::Blob(b) => String::from_utf8_lossy(&b).into_owned(),
            _ => String::new(),
        };
        Ok((id, data))
    }) else {
        return Vec::new();
    };

    let mut texts_by_msg: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if let Ok(mut part_stmt) = conn.prepare(
        "SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY time_created ASC",
    ) {
        if let Ok(part_rows) = part_stmt.query_map(params![session_id], |row| {
            let mid: String = row.get(0)?;
            let data: String = match row.get::<_, SqlValue>(1)? {
                SqlValue::Text(t) => t,
                SqlValue::Blob(b) => String::from_utf8_lossy(&b).into_owned(),
                _ => String::new(),
            };
            Ok((mid, data))
        }) {
            for (mid, data) in part_rows.flatten() {
                if let Ok(v) = serde_json::from_str::<Value>(&data) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                            if !t.trim().is_empty() {
                                texts_by_msg.entry(mid).or_default().push(t.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    for (id, data) in msg_rows.flatten() {
        let Ok(v) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let role = v.get("role").and_then(|x| x.as_str()).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let text = texts_by_msg
            .get(&id)
            .map(|parts| parts.join("\n"))
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        out.push(ChatHistoryMessage {
            role: role.to_string(),
            text: truncate_text(text),
        });
    }
    out
}

fn history_kimi(cwd: &str, session_id: &str, home: Option<&Path>) -> Vec<ChatHistoryMessage> {
    let Some(dir) = find_kimi_session_dir(cwd, session_id, home) else {
        return Vec::new();
    };
    let wire = dir.join("agents").join("main").join("wire.jsonl");
    history_jsonl_file(Some(&wire))
}

fn history_gemini(cwd: &str, session_id: &str, home: Option<&Path>) -> Vec<ChatHistoryMessage> {
    let Some(path) = find_gemini_file(cwd, session_id, home) else {
        return Vec::new();
    };
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if name.ends_with(".json") && !name.ends_with(".jsonl") {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                return messages_from_json_value(&v);
            }
        }
    }
    history_jsonl_file(Some(&path))
}

fn history_jsonl_file(path: Option<&Path>) -> Vec<ChatHistoryMessage> {
    let Some(path) = path else {
        return Vec::new();
    };
    if !path.is_file() {
        return Vec::new();
    }
    messages_from_jsonl_lines(path, |v| parse_generic_message(v))
}

fn messages_from_jsonl_lines<F>(path: &Path, mut map: F) -> Vec<ChatHistoryMessage>
where
    F: FnMut(&Value) -> Option<ChatHistoryMessage>,
{
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in BufReader::new(file).lines().flatten() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(m) = map(&v) {
            out.push(m);
        }
    }
    out
}

fn messages_from_json_value(v: &Value) -> Vec<ChatHistoryMessage> {
    let mut out = Vec::new();
    let arr = match v {
        Value::Array(a) => a.as_slice(),
        Value::Object(map) => {
            if let Some(Value::Array(a)) = map
                .get("messages")
                .or_else(|| map.get("history"))
                .or_else(|| map.get("chat"))
            {
                a.as_slice()
            } else {
                return out;
            }
        }
        _ => return out,
    };
    for item in arr {
        if let Some(m) = parse_generic_message(item) {
            out.push(m);
        }
    }
    out
}

fn parse_generic_message(v: &Value) -> Option<ChatHistoryMessage> {
    let role = v
        .get("type")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("role").and_then(|x| x.as_str()))
        .or_else(|| v.pointer("/message/role").and_then(|x| x.as_str()))
        .unwrap_or("");
    let role = match role {
        "user" | "human" => "user",
        "assistant" | "model" | "ai" => "assistant",
        _ => return None,
    };
    let content = v
        .pointer("/message/content")
        .or_else(|| v.get("content"))
        .or_else(|| v.get("text"))
        .or_else(|| v.get("message"));
    let text = match content {
        Some(c) => content_to_chat_text(c),
        None => return None,
    };
    if text.trim().is_empty() {
        return None;
    }
    Some(ChatHistoryMessage {
        role: role.to_string(),
        text: truncate_text(text),
    })
}

fn extract_user_query(text: &str) -> Option<String> {
    let start = text.find("<user_query>")?;
    let rest = &text[start + "<user_query>".len()..];
    let end = rest.find("</user_query>")?;
    let q = rest[..end].trim();
    if q.is_empty() {
        None
    } else {
        Some(q.to_string())
    }
}

fn looks_like_meta_user_blob(text: &str) -> bool {
    text.contains("<user_info>") && !text.contains("<user_query>")
}

fn truncate_text(s: String) -> String {
    if s.chars().count() <= MAX_TEXT_CHARS {
        return s;
    }
    let trimmed: String = s.chars().take(MAX_TEXT_CHARS).collect();
    format!("{trimmed}\n...")
}

fn merge_consecutive_assistants(msgs: Vec<ChatHistoryMessage>) -> Vec<ChatHistoryMessage> {
    let mut out: Vec<ChatHistoryMessage> = Vec::new();
    for m in msgs {
        if m.role == "assistant" {
            if let Some(last) = out.last_mut() {
                if last.role == "assistant" {
                    last.text.push_str("\n\n");
                    last.text.push_str(&m.text);
                    continue;
                }
            }
        }
        out.push(m);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn claude_history_extracts_user_assistant() {
        let tmp = std::env::temp_dir().join(format!("sema-hist-claude-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        let cwd = "/tmp/proj";
        let encoded = crate::resume::encode_claude_project_id(cwd);
        let proj = home.join(".claude").join("projects").join(&encoded);
        fs::create_dir_all(&proj).unwrap();
        let sid = "hist-sess-1";
        fs::write(
            proj.join(format!("{sid}.jsonl")),
            concat!(
                r#"{"type":"user","message":{"role":"user","content":"hello there"}}"#,
                "\n",
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi back"},{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}"#,
                "\n",
            ),
        )
        .unwrap();

        let r = load_chat_history("claude", cwd, Some(sid), Some(&home));
        let _ = fs::remove_dir_all(&tmp);
        assert_eq!(r.messages.len(), 2);
        assert_eq!(r.messages[0].role, "user");
        assert_eq!(r.messages[0].text, "hello there");
        assert_eq!(r.messages[1].role, "assistant");
        assert!(r.messages[1].text.contains("hi back"));
        assert!(r.messages[1].text.contains("```tool"));
        assert!(r.messages[1].text.contains("Shell ls") || r.messages[1].text.contains("Bash"));
    }

    #[test]
    fn cursor_history_prefers_agent_transcript_tools() {
        let tmp = std::env::temp_dir().join(format!("sema-hist-cursor-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        let sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let dir = home
            .join(".cursor")
            .join("projects")
            .join("D-tmp-proj")
            .join("agent-transcripts")
            .join(sid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("{sid}.jsonl")),
            concat!(
                r#"{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\nInvestigate pulse\n</user_query>"}]}}"#,
                "\n",
                r#"{"role":"assistant","message":{"content":[{"type":"text","text":"Looking."},{"type":"tool_use","name":"Read","input":{"path":"src/App.tsx","offset":1,"limit":10}},{"type":"tool_use","name":"Grep","input":{"pattern":"setBusy","path":"src"}}]}}"#,
                "\n",
            ),
        )
        .unwrap();

        let r = load_chat_history("cursor", "/tmp/proj", Some(sid), Some(&home));
        let _ = fs::remove_dir_all(&tmp);
        assert_eq!(r.messages.len(), 2);
        assert_eq!(r.messages[0].text, "Investigate pulse");
        assert!(r.messages[1].text.contains("Looking."));
        assert!(r.messages[1].text.contains("Read src/App.tsx"));
        assert!(r.messages[1].text.contains("Grep \"setBusy\""));
    }

    #[test]
    fn extract_user_query_inner() {
        let t = "<user_info>x</user_info>\n<user_query>\nDo the thing\n</user_query>";
        assert_eq!(extract_user_query(t).as_deref(), Some("Do the thing"));
    }
}
