//! Claude session artifacts from `~/.claude/projects/<encoded-cwd>/{session_id}.jsonl`.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::extract::collect_from_texts;
use super::types::ArtifactsResult;
use crate::platform::home_dir;
use crate::resume::cwd_path_candidates;

fn claude_project_ids(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in cwd_path_candidates(cwd) {
        let id: String = p
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
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

pub fn artifacts_for_claude(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    let Some(path) = find_claude_jsonl(cwd, session_id, home) else {
        return ArtifactsResult::default();
    };
    let texts = read_claude_jsonl(&path);
    collect_from_texts(&texts, cwd)
}

fn find_claude_jsonl(cwd: &str, session_id: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let ids = claude_project_ids(cwd);
    if ids.is_empty() {
        return None;
    }
    let root = home.join(".claude").join("projects");
    let filename = format!("{session_id}.jsonl");

    for id in &ids {
        let path = root.join(id).join(&filename);
        if path.is_file() {
            return Some(path);
        }
    }

    let Ok(entries) = fs::read_dir(&root) else {
        return None;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if ids.iter().any(|id| name == *id) {
            continue;
        }
        if ids
            .iter()
            .any(|id| name.ends_with(id) || id.ends_with(&name))
        {
            let path = root.join(&name).join(&filename);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn read_claude_jsonl(path: &Path) -> Vec<(u64, String)> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let mut texts = Vec::new();
    for (i, line) in BufReader::new(file).lines().enumerate() {
        let Ok(line) = line else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let mut parts = Vec::new();
        collect_strings(&value, &mut parts);
        if !parts.is_empty() {
            texts.push((i as u64, parts.join("\n")));
        }
    }
    texts
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) if !s.is_empty() => out.push(s.clone()),
        Value::Array(arr) => {
            for v in arr {
                collect_strings(v, out);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_strings(v, out);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn claude_two_sessions_same_cwd_do_not_mix() {
        let tmp = std::env::temp_dir().join(format!("sema-art-claude-iso-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let home = tmp.as_path();
        let cwd = "/tmp/proj";
        let encoded = crate::resume::encode_claude_project_id(cwd);
        let proj = home.join(".claude").join("projects").join(&encoded);
        fs::create_dir_all(&proj).unwrap();
        fs::write(
            proj.join("sess-a.jsonl"),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-a.example/x docs/a.md"}]}}"#,
        )
        .unwrap();
        fs::write(
            proj.join("sess-b.jsonl"),
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"https://only-b.example/y docs/b.md"}]}}"#,
        )
        .unwrap();
        let a = artifacts_for_claude(cwd, "  sess-a  ", Some(home));
        let missing = artifacts_for_claude(cwd, "sess-missing", Some(home));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }
}
