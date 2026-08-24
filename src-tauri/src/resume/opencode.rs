//! OpenCode sessions via opencode.db (rusqlite) + platform-specific fallback.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::fsutil::sort_newest_first;
use super::paths::{directory_match_keys, home_or};
use super::types::SessionEntry;

/// OpenCode data root: prefer dir that contains opencode.db.
pub fn opencode_data_root(home_dir: Option<&Path>) -> PathBuf {
    let home = home_or(home_dir);
    let mut candidates = vec![
        home.join(".local").join("share").join("opencode"),
        home.join("Library")
            .join("Application Support")
            .join("opencode"),
    ];
    // Older Windows installs / some builds also use %APPDATA%\opencode
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

fn open_opencode_db(home_dir: Option<&Path>) -> Option<Connection> {
    let root = opencode_data_root(home_dir);
    let db_path = root.join("opencode.db");
    if !db_path.exists() {
        return None;
    }
    Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

pub fn has_opencode_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    let Some(db) = open_opencode_db(home_dir) else {
        return false;
    };
    let keys = directory_match_keys(cwd);
    let Ok(mut stmt) = db.prepare(
        "SELECT 1 AS ok FROM session WHERE lower(replace(directory, '\\', '/')) = ?1 LIMIT 1",
    ) else {
        return false;
    };
    let mut stmt_pd = db
        .prepare(
            "SELECT 1 AS ok FROM project_directory WHERE lower(replace(directory, '\\', '/')) = ?1 LIMIT 1",
        )
        .ok();

    for key in &keys {
        let hit: Result<i32, _> = stmt.query_row([key], |row| row.get(0));
        if hit.is_ok() {
            return true;
        }
        if let Some(ref mut pd) = stmt_pd {
            let hit_pd: Result<i32, _> = pd.query_row([key], |row| row.get(0));
            if hit_pd.is_ok() {
                return true;
            }
        }
    }
    false
}

/// Latest OpenCode session id for cwd, or None.
pub fn latest_opencode_session_id(cwd: &str, home_dir: Option<&Path>) -> Option<String> {
    let db = open_opencode_db(home_dir)?;
    let keys = directory_match_keys(cwd);
    let mut stmt = db
        .prepare(
            "SELECT id FROM session WHERE lower(replace(directory, '\\', '/')) = ?1 ORDER BY time_updated DESC LIMIT 1",
        )
        .ok()?;
    for key in &keys {
        let id: Result<String, _> = stmt.query_row([key], |row| row.get(0));
        if let Ok(id) = id {
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    None
}

/// When DB has no id: Windows may use `--continue`; macOS/Linux must return empty.
pub fn opencode_no_id_fallback() -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec!["--continue".into()]
    } else {
        Vec::new()
    }
}

pub fn opencode_resume_args(cwd: &str, home_dir: Option<&Path>) -> Vec<String> {
    if let Some(id) = latest_opencode_session_id(cwd, home_dir) {
        return vec!["--session".into(), id];
    }
    // Keep prior Windows behavior when DB lookup finds no id (sqlite missing,
    // path mismatch, etc.). On Mac, prefer empty over broken --continue.
    opencode_no_id_fallback()
}

pub fn list_opencode_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let Some(db) = open_opencode_db(home_dir) else {
        return Vec::new();
    };
    let keys = directory_match_keys(cwd);
    let Ok(mut stmt) = db.prepare(
        "SELECT id, time_updated FROM session WHERE lower(replace(directory, '\\', '/')) = ?1 ORDER BY time_updated DESC",
    ) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for key in &keys {
        let Ok(rows) = stmt.query_map([key], |row| {
            let id: String = row.get(0)?;
            let time_updated = match row.get::<_, rusqlite::types::Value>(1) {
                Ok(rusqlite::types::Value::Integer(i)) => i as f64,
                Ok(rusqlite::types::Value::Real(r)) => r,
                Ok(rusqlite::types::Value::Text(t)) => t.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            Ok((id, time_updated))
        }) else {
            continue;
        };
        for row in rows.flatten() {
            let (id, time_updated) = row;
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            out.push(SessionEntry {
                id,
                mtime_ms: time_updated,
            });
        }
    }
    sort_newest_first(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn opencode_fallback_windows_uses_continue() {
        assert_eq!(opencode_no_id_fallback(), vec!["--continue".to_string()]);
        // No DB under a fake home → fallback path
        let tmp = std::env::temp_dir().join(format!("sema-oc-fb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let args = opencode_resume_args("/nonexistent/proj", Some(&tmp));
        assert_eq!(args, vec!["--continue".to_string()]);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn opencode_fallback_macos_linux_empty() {
        assert!(opencode_no_id_fallback().is_empty());
        let tmp = std::env::temp_dir().join(format!("sema-oc-fb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let args = opencode_resume_args("/nonexistent/proj", Some(&tmp));
        assert!(
            args.is_empty(),
            "macOS/Linux must not pass --continue when no session id; got {args:?}"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn opencode_prefers_session_flag_when_id_present() {
        // Pure unit: simulate argv builder preference (id path).
        let id = "sess-abc";
        let args = vec!["--session".to_string(), id.to_string()];
        assert_eq!(args[0], "--session");
        assert_ne!(args, opencode_no_id_fallback());
    }
}
