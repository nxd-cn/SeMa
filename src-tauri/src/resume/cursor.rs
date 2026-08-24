//! Cursor chats: ~/.cursor/chats/<md5(cwd)>/<id>/store.db only.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use md5::{Digest, Md5};

use super::fsutil::{mtime_ms, sort_newest_first};
use super::paths::{cwd_path_candidates, home_or};
use super::types::SessionEntry;

/// MD5 of path.resolve(cwd) — matches ~/.cursor/chats/<hash>/ layout.
pub fn cursor_workspace_hash(cwd: &str) -> String {
    cursor_workspace_hashes(cwd)
        .into_iter()
        .next()
        .unwrap_or_default()
}

/// All workspace hashes to probe (resolve + realpath) for Cursor chats.
pub fn cursor_workspace_hashes(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in cwd_path_candidates(cwd) {
        let mut hasher = Md5::new();
        hasher.update(p.as_bytes());
        let hex = format!("{:x}", hasher.finalize());
        if seen.insert(hex.clone()) {
            out.push(hex);
        }
    }
    out
}

fn find_store_db(dir: &Path, depth: u32) -> bool {
    if depth > 3 || !dir.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for e in entries.flatten() {
        let name = e.file_name();
        let p = e.path();
        if name == "store.db" {
            return true;
        }
        if p.is_dir() && find_store_db(&p, depth + 1) {
            return true;
        }
    }
    false
}

/// Global Cursor presence (legacy helper; `can_resume` uses cwd-scoped list).
pub fn has_cursor_sessions(home_dir: Option<&Path>) -> bool {
    let home = home_or(home_dir);
    let roots = [
        home.join(".cursor").join("chats"),
        home.join(".cursor").join("acp-sessions"),
        home.join(".config").join("cursor").join("chats"),
    ];
    if roots.iter().any(|r| find_store_db(r, 0)) {
        return true;
    }
    let projects = home.join(".cursor").join("projects");
    if !projects.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(&projects) else {
        return false;
    };
    for e in entries.flatten() {
        let transcripts = e.path().join("agent-transcripts");
        if !transcripts.exists() {
            continue;
        }
        if let Ok(t) = fs::read_dir(&transcripts) {
            if t.flatten().next().is_some() {
                return true;
            }
        }
    }
    false
}

/// Only directories that contain `store.db` (empty create-chat shells excluded).
pub fn list_cursor_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let home = home_or(home_dir);
    let hashes = cursor_workspace_hashes(cwd);
    if hashes.is_empty() {
        return Vec::new();
    }
    let mut roots = Vec::new();
    for hash in &hashes {
        roots.push(home.join(".cursor").join("chats").join(hash));
        roots.push(home.join(".config").join("cursor").join("chats").join(hash));
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.is_empty() || seen.contains(&name) {
                continue;
            }
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            // Cursor often creates empty chat shells (meta.json only) on spawn /
            // create-chat. Binding those makes ↻ restore a blank/old session.
            let store = p.join("store.db");
            if !store.exists() {
                continue;
            }
            let mut m = mtime_ms(&p);
            let store_m = mtime_ms(&store);
            if store_m > 0.0 {
                m = store_m;
            }
            seen.insert(name.clone());
            out.push(SessionEntry {
                id: name,
                mtime_ms: m,
            });
        }
    }
    sort_newest_first(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("sema-cursor-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn cursor_hash_is_md5_of_resolved_cwd() {
        let dir = test_tmp("hash");
        let cwd = dir.join("proj");
        fs::create_dir_all(&cwd).unwrap();
        let cwd_s = cwd.to_string_lossy().to_string();
        let h = cursor_workspace_hash(&cwd_s);
        assert_eq!(h.len(), 32);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_cursor_requires_store_db() {
        let tmp = test_tmp("list");
        let home = tmp.join("home");
        let cwd = tmp.join("proj");
        fs::create_dir_all(&cwd).unwrap();
        let hash = cursor_workspace_hash(&cwd.to_string_lossy());
        let chat_root = home.join(".cursor").join("chats").join(&hash);
        let empty = chat_root.join("empty-shell");
        let real = chat_root.join("real-chat");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("meta.json"), "{}").unwrap();
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("store.db"), "").unwrap();

        let listed = list_cursor_session_ids(&cwd.to_string_lossy(), Some(&home));
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "real-chat");
        let _ = fs::remove_dir_all(&tmp);
    }
}
