//! Gemini session artifacts from `~/.gemini/tmp/<hash>/chats/{id}.json` / `.jsonl`.

use std::fs;
use std::path::{Path, PathBuf};

use super::extract::{collect_from_texts, texts_from_json_or_jsonl};
use super::types::ArtifactsResult;
use crate::platform::home_dir;
use crate::resume::gemini_project_hashes;

pub fn artifacts_for_gemini(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    let Some(path) = find_gemini_file(cwd, session_id, home) else {
        return ArtifactsResult::default();
    };
    collect_from_texts(&texts_from_json_or_jsonl(&path), cwd)
}

fn find_gemini_file(cwd: &str, session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let tmp = home.join(".gemini").join("tmp");
    let hashes = gemini_project_hashes(cwd);
    let Ok(entries) = fs::read_dir(&tmp) else {
        return None;
    };
    let mut fallback = None;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let chats = e.path().join("chats");
        if !chats.is_dir() {
            continue;
        }
        let hashed = hashes.contains(&name);
        let Some(path) = find_in_chats(&chats, session_id) else {
            continue;
        };
        if hashed {
            return Some(path);
        }
        if fallback.is_none() {
            fallback = Some(path);
        }
    }
    fallback
}

fn find_in_chats(chats: &Path, session_id: &str) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(chats) else {
        return None;
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
        if gemini_file_session_id(&name, &p) == session_id {
            return Some(p);
        }
    }
    None
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

fn gemini_file_session_id(name: &str, path: &Path) -> String {
    let mut sid = if let Some(stripped) = name.strip_suffix(".jsonl") {
        stripped.to_string()
    } else if let Some(stripped) = name.strip_suffix(".json") {
        stripped.to_string()
    } else {
        name.to_string()
    };
    if let Some(u) = extract_trailing_uuid(&sid) {
        sid = u.to_string();
    }
    if !is_uuid(&sid) {
        if let Ok(raw) = fs::read(path) {
            let end = raw.len().min(4000);
            let text = String::from_utf8_lossy(&raw[..end]);
            if let Some(id) = session_id_from_json_prefix(&text) {
                sid = id;
            }
        }
    }
    sid
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn gemini_two_sessions_same_cwd_do_not_mix() {
        let tmp = std::env::temp_dir().join(format!("sema-art-gemini-iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.as_path();
        let cwd = "/tmp/proj";
        let hash = crate::resume::gemini_project_hashes(cwd)
            .into_iter()
            .next()
            .expect("gemini hash");
        let chats = home.join(".gemini").join("tmp").join(&hash).join("chats");
        fs::create_dir_all(&chats).unwrap();
        let id_a = "11111111-1111-4111-8111-111111111111";
        let id_b = "22222222-2222-4222-8222-222222222222";
        fs::write(
            chats.join(format!("{id_a}.json")),
            r#"{"sessionId":"11111111-1111-4111-8111-111111111111","text":"https://only-a.example/x docs/a.md"}"#,
        )
        .unwrap();
        fs::write(
            chats.join(format!("{id_b}.json")),
            r#"{"sessionId":"22222222-2222-4222-8222-222222222222","text":"https://only-b.example/y docs/b.md"}"#,
        )
        .unwrap();
        let a = artifacts_for_gemini(cwd, "  11111111-1111-4111-8111-111111111111  ", Some(home));
        let missing = artifacts_for_gemini(cwd, "33333333-3333-4333-8333-333333333333", Some(home));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }
}
