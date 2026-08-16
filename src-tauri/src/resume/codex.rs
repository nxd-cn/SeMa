//! Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<uuid>.jsonl

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::fsutil::{file_mentions_cwd, mtime_ms, sort_newest_first};
use super::paths::{home_or, path_variants};
use super::types::SessionEntry;

/// Extract UUIDv7 from rollout-<ts>-<uuid>.jsonl (last 5 dash segments).
pub fn codex_session_id_from_name(name: &str) -> Option<String> {
    // JS: name.replace(/\.jsonl(\.zst)?$/i, "")
    let lower = name.to_ascii_lowercase();
    let base = if let Some(rest) = lower.strip_suffix(".jsonl.zst") {
        &name[..rest.len()]
    } else if let Some(rest) = lower.strip_suffix(".jsonl") {
        &name[..rest.len()]
    } else {
        name
    };
    let parts: Vec<&str> = base.split('-').collect();
    if parts.len() < 5 {
        if base.is_empty() {
            return None;
        }
        return Some(base.to_string());
    }
    Some(parts[parts.len() - 5..].join("-"))
}

pub fn has_codex_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    !list_codex_session_ids(cwd, home_dir).is_empty()
}

/// Scoped by session_meta cwd (fileMentionsCwd on first chunk).
pub fn list_codex_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let home = home_or(home_dir);
    let root = home.join(".codex").join("sessions");
    if !root.exists() {
        return Vec::new();
    }
    let variants = path_variants(cwd);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    fn walk(
        dir: &Path,
        depth: u32,
        variants: &[String],
        seen: &mut HashSet<String>,
        out: &mut Vec<SessionEntry>,
    ) {
        if depth > 5 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() {
                walk(&p, depth + 1, variants, seen, out);
                continue;
            }
            let lower = name.to_lowercase();
            if !(lower.ends_with(".jsonl") || lower.ends_with(".jsonl.zst")) {
                continue;
            }
            if !file_mentions_cwd(&p, variants) {
                continue;
            }
            let Some(sid) = codex_session_id_from_name(&name) else {
                continue;
            };
            if sid.is_empty() || !seen.insert(sid.clone()) {
                continue;
            }
            out.push(SessionEntry {
                id: sid,
                mtime_ms: mtime_ms(&p),
            });
        }
    }

    walk(&root, 0, &variants, &mut seen, &mut out);
    sort_newest_first(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_id_from_rollout_name() {
        let id = codex_session_id_from_name(
            "rollout-2026-01-02T03-04-05-7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab.jsonl",
        );
        assert_eq!(
            id.as_deref(),
            Some("7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab")
        );
    }
}
