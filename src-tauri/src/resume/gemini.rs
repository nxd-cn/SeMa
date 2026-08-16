//! Gemini: ~/.gemini/tmp/<project_hash>/chats/<session>.json

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use md5::{Digest, Md5};
use sha1::Sha1;
use sha2::Sha256;

use super::fsutil::{file_mentions_cwd, mtime_ms, sort_newest_first};
use super::paths::{home_or, path_variants};
use super::types::SessionEntry;

pub fn gemini_project_hashes(cwd: &str) -> HashSet<String> {
    let forms = path_variants(cwd);
    let mut out = HashSet::new();
    for f in forms {
        out.insert(format!("{:x}", Sha1::digest(f.as_bytes())));
        let sha256_full = format!("{:x}", Sha256::digest(f.as_bytes()));
        out.insert(sha256_full.chars().take(32).collect());
        out.insert(format!("{:x}", Md5::digest(f.as_bytes())));
    }
    out
}

pub fn has_gemini_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    !list_gemini_session_ids(cwd, home_dir).is_empty()
}

fn gemini_project_chat_dirs(cwd: &str, home_dir: Option<&Path>) -> Vec<PathBuf> {
    let home = home_or(home_dir);
    let tmp = home.join(".gemini").join("tmp");
    if !tmp.exists() {
        return Vec::new();
    }
    let variants = path_variants(cwd);
    let hashes = gemini_project_hashes(cwd);
    let mut dirs = Vec::new();
    let Ok(entries) = fs::read_dir(&tmp) else {
        return Vec::new();
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let project_dir = e.path();
        let chats = project_dir.join("chats");
        if !chats.exists() {
            continue;
        }
        let mut matched = hashes.contains(&name);
        if !matched {
            let logs = project_dir.join("logs.json");
            if logs.exists() && file_mentions_cwd(&logs, &variants) {
                matched = true;
            }
        }
        if !matched {
            if let Ok(chat_files) = fs::read_dir(&chats) {
                let files: Vec<_> = chat_files
                    .flatten()
                    .filter(|f| {
                        let n = f.file_name().to_string_lossy().into_owned();
                        n.ends_with(".json") || n.ends_with(".jsonl")
                    })
                    .take(8)
                    .collect();
                for f in files {
                    if file_mentions_cwd(&f.path(), &variants) {
                        matched = true;
                        break;
                    }
                }
            }
        }
        if matched {
            dirs.push(chats);
        }
    }
    dirs
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

fn extract_trailing_uuid(s: &str) -> Option<&str> {
    if s.len() >= 36 {
        let candidate = &s[s.len() - 36..];
        if is_uuid(candidate) {
            return Some(candidate);
        }
    }
    None
}

fn session_id_from_json_prefix(raw: &str) -> Option<String> {
    for key in ["\"sessionId\"", "\"id\""] {
        if let Some(pos) = raw.find(key) {
            let after = &raw[pos + key.len()..];
            if let Some(colon) = after.find(':') {
                let rest = after[colon + 1..].trim_start();
                if let Some(rest) = rest.strip_prefix('"') {
                    if let Some(end) = rest.find('"') {
                        let id = &rest[..end];
                        if is_uuid(id) {
                            return Some(id.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// Resume: gemini --resume <uuid>
pub fn list_gemini_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for chats in gemini_project_chat_dirs(cwd, home_dir) {
        let Ok(entries) = fs::read_dir(&chats) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !(name.ends_with(".json") || name.ends_with(".jsonl")) {
                continue;
            }
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let mut sid = if let Some(stripped) = name.strip_suffix(".jsonl") {
                stripped.to_string()
            } else if let Some(stripped) = name.strip_suffix(".json") {
                stripped.to_string()
            } else {
                name.clone()
            };
            if let Some(u) = extract_trailing_uuid(&sid) {
                sid = u.to_string();
            }
            if !is_uuid(&sid) {
                if let Ok(raw) = fs::read(&p) {
                    let end = raw.len().min(4000);
                    let text = String::from_utf8_lossy(&raw[..end]);
                    if let Some(id) = session_id_from_json_prefix(&text) {
                        sid = id;
                    }
                }
            }
            if sid.is_empty() || !seen.insert(sid.clone()) {
                continue;
            }
            out.push(SessionEntry {
                id: sid,
                mtime_ms: mtime_ms(&p),
            });
        }
    }
    sort_newest_first(&mut out);
    out
}
