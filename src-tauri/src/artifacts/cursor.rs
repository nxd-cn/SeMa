//! Cursor session artifacts from `~/.cursor/chats/<hash>/<id>/store.db` blobs.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use super::extract::{collect_from_texts, collect_json_strings};
use super::types::ArtifactsResult;
use crate::platform::home_dir;
use crate::resume::cursor_workspace_hashes;

pub fn artifacts_for_cursor(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() || !is_safe_session_id(session_id) {
        return ArtifactsResult::default();
    }
    let Some(path) = find_cursor_store_db(cwd, session_id, home) else {
        return ArtifactsResult::default();
    };
    let texts = read_cursor_blobs(&path);
    collect_from_texts(&texts, cwd)
}

fn is_safe_session_id(id: &str) -> bool {
    !id.contains('/') && !id.contains('\\') && !id.contains("..")
}

fn find_cursor_store_db(cwd: &str, session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let hashes = cursor_workspace_hashes(cwd);
    if hashes.is_empty() {
        return None;
    }
    for hash in &hashes {
        let candidates = [
            home.join(".cursor")
                .join("chats")
                .join(hash)
                .join(session_id)
                .join("store.db"),
            home.join(".config")
                .join("cursor")
                .join("chats")
                .join(hash)
                .join(session_id)
                .join("store.db"),
        ];
        for path in candidates {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

const STORE_BUSY_TIMEOUT: Duration = Duration::from_millis(500);

/// Read-only SQLite URI so a live Cursor writer is less likely to fail the open.
fn sqlite_readonly_uri(path: &Path) -> String {
    let unified = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::with_capacity(unified.len() + 16);
    for ch in unified.chars() {
        match ch {
            ' ' => encoded.push_str("%20"),
            '#' => encoded.push_str("%23"),
            '?' => encoded.push_str("%3F"),
            '%' => encoded.push_str("%25"),
            _ => encoded.push(ch),
        }
    }
    if encoded.starts_with('/') {
        format!("file://{encoded}?mode=ro")
    } else {
        format!("file:///{encoded}?mode=ro")
    }
}

fn open_store_readonly(path: &Path) -> Option<Connection> {
    let uri_flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let path_flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(sqlite_readonly_uri(path), uri_flags)
        .or_else(|_| Connection::open_with_flags(path, path_flags))
        .ok()?;
    let _ = conn.busy_timeout(STORE_BUSY_TIMEOUT);
    Some(conn)
}

fn read_cursor_blobs(path: &Path) -> Vec<(u64, String)> {
    let Some(conn) = open_store_readonly(path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare("SELECT rowid, data FROM blobs ORDER BY rowid ASC") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let rowid: i64 = row.get(0)?;
        let data: Vec<u8> = row.get(1)?;
        Ok((rowid, data))
    }) else {
        return Vec::new();
    };

    let mut texts = Vec::new();
    for row in rows.flatten() {
        let (rowid, data) = row;
        let Some(text) = blob_to_text(&data) else {
            continue;
        };
        let seq = if rowid < 0 { 0 } else { rowid as u64 };
        texts.push((seq, text));
    }
    texts
}

fn blob_to_text(data: &[u8]) -> Option<String> {
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(value) = serde_json::from_str::<Value>(s) {
            let mut parts = Vec::new();
            collect_role_content(&value, &mut parts);
            if !parts.is_empty() {
                return Some(parts.join("\n"));
            }
        }
        let lossy_parts = assistant_json_substrings(s);
        if !lossy_parts.is_empty() {
            return Some(lossy_parts.join("\n"));
        }
        return None;
    }
    let lossy = String::from_utf8_lossy(data);
    let parts = assistant_json_substrings(&lossy);
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn collect_role_content(value: &Value, out: &mut Vec<String>) {
    if let Some(text) = text_from_role_content(value) {
        out.push(text);
        return;
    }
    match value {
        Value::Array(arr) => {
            for v in arr {
                collect_role_content(v, out);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_role_content(v, out);
            }
        }
        _ => {}
    }
}

fn text_from_role_content(value: &Value) -> Option<String> {
    let obj = value.as_object()?;
    if !obj.contains_key("role") || !obj.contains_key("content") {
        return None;
    }
    let text = stringify_content(obj.get("content")?);
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn stringify_content(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut parts = Vec::new();
            for v in arr {
                match v {
                    Value::String(s) if !s.is_empty() => parts.push(s.clone()),
                    Value::Object(map) => {
                        if let Some(Value::String(t)) = map.get("text") {
                            if !t.is_empty() {
                                parts.push(t.clone());
                                continue;
                            }
                        }
                        collect_json_strings(v, &mut parts);
                    }
                    other => collect_json_strings(other, &mut parts),
                }
            }
            parts.join("\n")
        }
        other => {
            let mut parts = Vec::new();
            collect_json_strings(other, &mut parts);
            parts.join("\n")
        }
    }
}

fn assistant_json_substrings(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = json_object_end(s, i) {
                let slice = &s[i..end];
                if looks_like_assistant_role(slice) {
                    if let Ok(value) = serde_json::from_str::<Value>(slice) {
                        if let Some(text) = text_from_role_content(&value) {
                            out.push(text);
                        }
                    }
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn looks_like_assistant_role(s: &str) -> bool {
    s.contains(r#""role":"assistant""#) || s.contains(r#""role": "assistant""#)
}

fn json_object_end(s: &str, start: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if start >= bytes.len() || bytes[start] != b'{' {
        return None;
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (offset, &b) in bytes[start..].iter().enumerate() {
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(start + offset + 1);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;

    fn write_blob_db(path: &Path, texts: &[&str]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);")
            .unwrap();
        for (i, t) in texts.iter().enumerate() {
            let json = format!(
                r#"{{"role":"assistant","content":{}}}"#,
                serde_json::to_string(t).unwrap()
            );
            conn.execute(
                "INSERT INTO blobs (id, data) VALUES (?1, ?2)",
                params![i.to_string(), json.as_bytes()],
            )
            .unwrap();
        }
    }

    fn write_raw_blob_db(path: &Path, blobs: &[&[u8]]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);")
            .unwrap();
        for (i, data) in blobs.iter().enumerate() {
            conn.execute(
                "INSERT INTO blobs (id, data) VALUES (?1, ?2)",
                params![i.to_string(), *data],
            )
            .unwrap();
        }
    }

    fn test_home(label: &str) -> (std::path::PathBuf, std::path::PathBuf, String) {
        let tmp =
            std::env::temp_dir().join(format!("sema-art-cursor-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.join("home");
        let cwd_dir = tmp.join("proj");
        fs::create_dir_all(&cwd_dir).unwrap();
        let cwd = cwd_dir.to_string_lossy().to_string();
        (tmp, home, cwd)
    }

    #[test]
    fn cursor_two_sessions_same_hash_do_not_mix() {
        let (tmp, home, cwd) = test_home("iso");
        let hash = crate::resume::cursor_workspace_hash(&cwd);
        let chat_root = home.join(".cursor").join("chats").join(&hash);
        let dir_a = chat_root.join("sess-a");
        let dir_b = chat_root.join("sess-b");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        write_blob_db(
            &dir_a.join("store.db"),
            &["https://only-a.example/x docs/a.md"],
        );
        write_blob_db(
            &dir_b.join("store.db"),
            &["https://only-b.example/y docs/b.md"],
        );

        let a = artifacts_for_cursor(&cwd, "  sess-a  ", Some(&home));
        let missing = artifacts_for_cursor(&cwd, "sess-missing", Some(&home));
        let _ = fs::remove_dir_all(&tmp);

        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }

    #[test]
    fn cursor_lossy_blob_extracts_assistant_json() {
        let (tmp, home, cwd) = test_home("lossy");
        let hash = crate::resume::cursor_workspace_hash(&cwd);
        let dir = home
            .join(".cursor")
            .join("chats")
            .join(&hash)
            .join("sess-lossy");
        fs::create_dir_all(&dir).unwrap();
        let mut blob = vec![0xff, 0xfe, 0x00];
        blob.extend_from_slice(
            br#"{"role":"assistant","content":"https://lossy-a.example/z notes.md"}"#,
        );
        blob.extend_from_slice(&[0x00, 0xff]);
        write_raw_blob_db(&dir.join("store.db"), &[&blob]);

        let r = artifacts_for_cursor(&cwd, "sess-lossy", Some(&home));
        let _ = fs::remove_dir_all(&tmp);

        assert!(r.links.iter().any(|l| l.url.contains("lossy-a")));
    }

    #[test]
    fn sqlite_readonly_uri_uses_mode_ro() {
        let uri = sqlite_readonly_uri(Path::new("/tmp/store.db"));
        assert!(uri.starts_with("file:"));
        assert!(uri.contains("mode=ro"));
        assert!(uri.contains("/tmp/store.db") || uri.contains("tmp/store.db"));
    }
}
