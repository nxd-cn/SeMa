//! Pi sessions: ~/.pi/agent/sessions/--<encoded-cwd>--/

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::fsutil::{dir_has_session_files, mtime_ms, sort_newest_first};
use super::paths::{cwd_path_candidates, home_or, path_resolve, path_to_string};
use super::types::SessionEntry;

/// Pi session folder: `--` + path with `:`/`\`/`/` → `-` + `--`
pub fn encode_pi_session_dir(cwd: &str) -> String {
    let encoded = path_to_string(&path_resolve(cwd))
        .chars()
        .map(|c| match c {
            ':' | '\\' | '/' => '-',
            other => other,
        })
        .collect::<String>();
    format!("--{encoded}--")
}

pub fn pi_session_dir_names(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in cwd_path_candidates(cwd) {
        let encoded: String = p
            .chars()
            .map(|c| match c {
                ':' | '\\' | '/' => '-',
                other => other,
            })
            .collect();
        let name = format!("--{encoded}--");
        if seen.insert(name.clone()) {
            out.push(name);
        }
    }
    out
}

pub fn has_pi_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    let home = home_or(home_dir);
    for name in pi_session_dir_names(cwd) {
        let dir = home
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join(&name);
        if dir_has_session_files(&dir) {
            return true;
        }
    }
    false
}

/// Extract trailing UUID after `_` from a Pi jsonl basename (no extension).
fn pi_session_id_from_base(base: &str) -> String {
    if let Some(idx) = base.rfind('_') {
        let candidate = &base[idx + 1..];
        if is_uuid(candidate) {
            return candidate.to_string();
        }
    }
    base.to_string()
}

fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if c != b'-' {
                    return false;
                }
            }
            _ => {
                if !c.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

/// Pi session files: `2026-07-21T02-25-08-355Z_<uuid>.jsonl`
pub fn list_pi_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let home = home_or(home_dir);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let mut scan = |folder: &Path| {
        if !folder.exists() {
            return;
        }
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let base = name.trim_end_matches(".jsonl");
            let sid = pi_session_id_from_base(base);
            if sid.is_empty() || !seen.insert(sid.clone()) {
                continue;
            }
            let m = mtime_ms(&folder.join(&name));
            out.push(SessionEntry {
                id: sid,
                mtime_ms: m,
            });
        }
    };

    for name in pi_session_dir_names(cwd) {
        let dir = home
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join(&name);
        scan(&dir);
        scan(&dir.join("sessions"));
    }
    sort_newest_first(&mut out);
    out
}
