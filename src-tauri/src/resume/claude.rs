//! Claude session discovery under ~/.claude/projects/<encoded-cwd>/.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::fsutil::{dir_has_session_files, mtime_ms, sort_newest_first};
use super::paths::{cwd_path_candidates, home_or, path_resolve, path_to_string};
use super::types::SessionEntry;

/// Claude project id: abs path with non-alphanumeric → `-`
pub fn encode_claude_project_id(cwd: &str) -> String {
    path_to_string(&path_resolve(cwd))
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect()
}

pub fn claude_project_ids(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in cwd_path_candidates(cwd) {
        let id: String = p
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

pub fn has_claude_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    let home = home_or(home_dir);
    let ids = claude_project_ids(cwd);
    if ids.is_empty() {
        return false;
    }
    let root = home.join(".claude").join("projects");
    for id in &ids {
        if dir_has_session_files(&root.join(id)) {
            return true;
        }
    }
    if !root.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(&root) else {
        return false;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if ids
            .iter()
            .any(|id| name == *id || name.ends_with(id) || id.ends_with(&name))
            && dir_has_session_files(&root.join(&name))
        {
            return true;
        }
    }
    false
}

pub fn list_claude_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let home = home_or(home_dir);
    let ids = claude_project_ids(cwd);
    if ids.is_empty() {
        return Vec::new();
    }
    let root = home.join(".claude").join("projects");
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen_dir: HashSet<String> = HashSet::new();

    for id in &ids {
        let primary = root.join(id);
        let key = path_to_string(&primary);
        if primary.exists() && seen_dir.insert(key) {
            dirs.push(primary);
        }
    }
    if root.exists() {
        if let Ok(entries) = fs::read_dir(&root) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if ids.iter().any(|id| name == *id) {
                    continue;
                }
                if ids
                    .iter()
                    .any(|id| name.ends_with(id) || id.ends_with(&name))
                {
                    let p = root.join(&name);
                    let key = path_to_string(&p);
                    if seen_dir.insert(key) {
                        dirs.push(p);
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let sid = name.trim_end_matches(".jsonl").to_string();
            if sid.is_empty() || !seen.insert(sid.clone()) {
                continue;
            }
            let mtime = mtime_ms(&dir.join(&name));
            out.push(SessionEntry {
                id: sid,
                mtime_ms: mtime,
            });
        }
    }
    sort_newest_first(&mut out);
    out
}
