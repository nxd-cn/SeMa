//! Pi session artifacts from `~/.pi/agent/sessions/<encoded>/*_{uuid}.jsonl`.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::extract::{collect_from_texts, texts_from_jsonl};
use super::types::ArtifactsResult;
use crate::platform::home_dir;
use crate::resume::{cwd_path_candidates, encode_pi_session_dir};

pub fn artifacts_for_pi(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    let Some(path) = find_pi_jsonl(cwd, session_id, home) else {
        return ArtifactsResult::default();
    };
    collect_from_texts(&texts_from_jsonl(&path), cwd)
}

fn pi_session_folders(cwd: &str, home: &Path) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |name: String| {
        if seen.insert(name.clone()) {
            out.push(home.join(".pi").join("agent").join("sessions").join(name));
        }
    };
    add(encode_pi_session_dir(cwd));
    for p in cwd_path_candidates(cwd) {
        let encoded: String = p
            .chars()
            .map(|c| match c {
                ':' | '\\' | '/' => '-',
                other => other,
            })
            .collect();
        add(format!("--{encoded}--"));
    }
    out
}

fn find_pi_jsonl(cwd: &str, session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    for dir in pi_session_folders(cwd, &home) {
        if let Some(p) = scan_pi_dir(&dir, session_id) {
            return Some(p);
        }
        if let Some(p) = scan_pi_dir(&dir.join("sessions"), session_id) {
            return Some(p);
        }
    }
    None
}

fn scan_pi_dir(folder: &Path, session_id: &str) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(folder) else {
        return None;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".jsonl") {
            continue;
        }
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let base = name.trim_end_matches(".jsonl");
        if pi_session_id_from_base(base) == session_id {
            return Some(p);
        }
    }
    None
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn pi_two_sessions_same_cwd_do_not_mix() {
        let tmp = std::env::temp_dir().join(format!("sema-art-pi-iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.as_path();
        let cwd = "/tmp/proj";
        let encoded = crate::resume::encode_pi_session_dir(cwd);
        let dir = home
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join(&encoded);
        fs::create_dir_all(&dir).unwrap();
        let id_a = "11111111-1111-4111-8111-111111111111";
        let id_b = "22222222-2222-4222-8222-222222222222";
        fs::write(
            dir.join(format!("2026-07-21T02-25-08-355Z_{id_a}.jsonl")),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-a.example/x docs/a.md"}]}}"#,
        )
        .unwrap();
        fs::write(
            dir.join(format!("2026-07-21T02-25-08-356Z_{id_b}.jsonl")),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-b.example/y docs/b.md"}]}}"#,
        )
        .unwrap();
        let a = artifacts_for_pi(cwd, "  11111111-1111-4111-8111-111111111111  ", Some(home));
        let missing = artifacts_for_pi(cwd, "33333333-3333-4333-8333-333333333333", Some(home));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }
}
