//! OpenCode session artifacts from `opencode.db` (`part`, fallback `message` / `session_message`).

use std::path::{Path, PathBuf};

use rusqlite::{types::Value as SqlValue, Connection, OpenFlags};
use serde_json::Value;

use super::extract::{collect_from_texts, collect_json_strings};
use super::types::ArtifactsResult;
use crate::platform::home_dir;

fn opencode_data_root(home: Option<&Path>) -> PathBuf {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let mut candidates = vec![
        home.join(".local").join("share").join("opencode"),
        home.join("Library")
            .join("Application Support")
            .join("opencode"),
    ];
    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            if !app_data.is_empty() {
                candidates.push(PathBuf::from(app_data).join("opencode"));
            }
        }
    }
    for root in &candidates {
        if root.join("opencode.db").exists() {
            return root.clone();
        }
    }
    for root in &candidates {
        if root.exists() {
            return root.clone();
        }
    }
    candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| home.join(".local").join("share").join("opencode"))
}

pub fn artifacts_for_opencode(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    collect_from_texts(&read_opencode_texts(session_id, home), cwd)
}

fn open_readonly(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

fn read_opencode_texts(session_id: &str, home: Option<&Path>) -> Vec<(u64, String)> {
    let db_path = opencode_data_root(home).join("opencode.db");
    if !db_path.is_file() {
        return Vec::new();
    }
    let Some(conn) = open_readonly(&db_path) else {
        return Vec::new();
    };
    let parts = query_time_data(
        &conn,
        "SELECT time_created, data FROM part WHERE session_id = ?1 ORDER BY time_created ASC",
        session_id,
    );
    if !parts.is_empty() {
        return parts;
    }
    let mut fallback = query_time_data(
        &conn,
        "SELECT time_created, data FROM message WHERE session_id = ?1 ORDER BY time_created ASC",
        session_id,
    );
    fallback.extend(query_time_data(
        &conn,
        "SELECT time_created, data FROM session_message WHERE session_id = ?1 ORDER BY time_created ASC",
        session_id,
    ));
    fallback.sort_by_key(|(seq, _)| *seq);
    fallback
}

fn query_time_data(conn: &Connection, sql: &str, session_id: &str) -> Vec<(u64, String)> {
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([session_id], |row| {
        let seq = time_to_seq(row.get::<_, SqlValue>(0)?);
        let data = data_to_string(row.get::<_, SqlValue>(1)?);
        Ok((seq, data))
    }) else {
        return Vec::new();
    };

    let mut texts = Vec::new();
    for row in rows.flatten() {
        let (seq, data) = row;
        if let Some(text) = json_data_to_text(&data) {
            texts.push((seq, text));
        }
    }
    texts
}

fn time_to_seq(value: SqlValue) -> u64 {
    match value {
        SqlValue::Integer(i) => i.max(0) as u64,
        SqlValue::Real(r) => {
            if r <= 0.0 {
                0
            } else {
                r as u64
            }
        }
        SqlValue::Text(t) => t.parse().unwrap_or(0),
        _ => 0,
    }
}

fn data_to_string(value: SqlValue) -> String {
    match value {
        SqlValue::Text(t) => t,
        SqlValue::Blob(b) => String::from_utf8_lossy(&b).into_owned(),
        _ => String::new(),
    }
}

fn json_data_to_text(data: &str) -> Option<String> {
    let trimmed = data.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        let mut parts = Vec::new();
        collect_json_strings(&value, &mut parts);
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n"))
        }
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::Path;

    fn test_home(label: &str) -> (std::path::PathBuf, std::path::PathBuf, String) {
        let tmp =
            std::env::temp_dir().join(format!("sema-art-opencode-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.join("home");
        let cwd = "/tmp/proj".to_string();
        (tmp, home, cwd)
    }

    fn db_path(home: &Path) -> std::path::PathBuf {
        let dir = home.join(".local").join("share").join("opencode");
        fs::create_dir_all(&dir).unwrap();
        dir.join("opencode.db")
    }

    fn write_part_db(path: &Path, rows: &[(&str, i64, &str)]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT
            );",
        )
        .unwrap();
        for (i, (session_id, time_created, text)) in rows.iter().enumerate() {
            let data = serde_json::json!({ "type": "text", "text": text }).to_string();
            conn.execute(
                "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
                params![
                    format!("prt-{i}"),
                    format!("msg-{i}"),
                    session_id,
                    time_created,
                    data
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn opencode_two_session_ids_in_db_do_not_mix() {
        let (tmp, home, cwd) = test_home("iso");
        write_part_db(
            &db_path(&home),
            &[
                ("sess-a", 100, "https://only-a.example/x docs/a.md"),
                ("sess-b", 200, "https://only-b.example/y docs/b.md"),
            ],
        );

        let a = artifacts_for_opencode(&cwd, "  sess-a  ", Some(&home));
        let missing = artifacts_for_opencode(&cwd, "sess-missing", Some(&home));
        let _ = fs::remove_dir_all(&tmp);

        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }

    fn write_fallback_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT
            );
            CREATE TABLE session_message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                type TEXT,
                seq INTEGER,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT
            );",
        )
        .unwrap();
        let msg_a = serde_json::json!({
            "role": "assistant",
            "content": "https://msg-a.example/x notes.md"
        })
        .to_string();
        let msg_b = serde_json::json!({
            "role": "assistant",
            "content": "https://msg-b.example/y other.md"
        })
        .to_string();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES ('m1', 'sess-a', 10, 10, ?1)",
            params![msg_a],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
             VALUES ('sm1', 'sess-b', 'assistant', 1, 20, 20, ?1)",
            params![msg_b],
        )
        .unwrap();
    }

    #[test]
    fn opencode_falls_back_to_message_tables_when_parts_empty() {
        let (tmp, home, cwd) = test_home("fallback");
        write_fallback_db(&db_path(&home));

        let a = artifacts_for_opencode(&cwd, "sess-a", Some(&home));
        let b = artifacts_for_opencode(&cwd, "sess-b", Some(&home));
        let _ = fs::remove_dir_all(&tmp);

        assert!(a.links.iter().any(|l| l.url.contains("msg-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("msg-b")));
        assert!(b.links.iter().any(|l| l.url.contains("msg-b")));
        assert!(!b.links.iter().any(|l| l.url.contains("msg-a")));
    }
}
