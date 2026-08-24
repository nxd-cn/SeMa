//! Codex session artifacts from `~/.codex/sessions/**/rollout-*-{uuid}.jsonl`.

use std::fs;
use std::path::{Path, PathBuf};

use super::extract::{collect_from_texts, texts_from_jsonl};
use super::types::ArtifactsResult;
use crate::platform::home_dir;
use crate::resume::codex_session_id_from_name;

pub fn artifacts_for_codex(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    let Some(path) = find_codex_jsonl(session_id, home) else {
        return ArtifactsResult::default();
    };
    collect_from_texts(&texts_from_jsonl(&path), cwd)
}

fn find_codex_jsonl(session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let root = home.join(".codex").join("sessions");
    walk_codex(&root, 0, session_id)
}

fn walk_codex(dir: &Path, depth: u32, session_id: &str) -> Option<PathBuf> {
    if depth > 5 {
        return None;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return None;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(found) = walk_codex(&p, depth + 1, session_id) {
                return Some(found);
            }
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".jsonl") {
            continue;
        }
        let Some(sid) = codex_session_id_from_name(&name) else {
            continue;
        };
        if sid == session_id {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn codex_two_sessions_same_cwd_do_not_mix() {
        let tmp = std::env::temp_dir().join(format!("sema-art-codex-iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.as_path();
        let cwd = "/tmp/proj";
        let day = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("08")
            .join("15");
        fs::create_dir_all(&day).unwrap();
        let id_a = "11111111-1111-4111-8111-111111111111";
        let id_b = "22222222-2222-4222-8222-222222222222";
        fs::write(
            day.join(format!("rollout-2026-08-15T10-00-00-{id_a}.jsonl")),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-a.example/x docs/a.md"}]}}"#,
        )
        .unwrap();
        fs::write(
            day.join(format!("rollout-2026-08-15T10-00-01-{id_b}.jsonl")),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-b.example/y docs/b.md"}]}}"#,
        )
        .unwrap();
        let a = artifacts_for_codex(cwd, "  11111111-1111-4111-8111-111111111111  ", Some(home));
        let missing = artifacts_for_codex(cwd, "33333333-3333-4333-8333-333333333333", Some(home));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }
}
