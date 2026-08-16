//! Public resume API: can_resume, list_session_ids, resolve_resume_selection, …

use std::collections::HashSet;
use std::path::Path;

use super::args::{resume_args_for_id, resume_args_unchecked, supports_resume};
use super::claude::{has_claude_session, list_claude_session_ids};
use super::codex::{has_codex_session, list_codex_session_ids};
use super::cursor::list_cursor_session_ids;
use super::gemini::{has_gemini_session, list_gemini_session_ids};
use super::opencode::{has_opencode_session, list_opencode_session_ids, opencode_resume_args};
use super::pi::{has_pi_session, list_pi_session_ids};
use super::types::{ResumeOpts, ResumeSelection, SessionEntry};

pub fn can_resume(cli_id: &str, cwd: &str, home_dir: Option<&Path>) -> bool {
    match cli_id {
        "claude" => has_claude_session(cwd, home_dir),
        // Cursor chats are per workspace hash — do not use global ~/.cursor presence.
        "cursor" => !list_cursor_session_ids(cwd, home_dir).is_empty(),
        "opencode" => has_opencode_session(cwd, home_dir),
        "pi" => has_pi_session(cwd, home_dir),
        "codex" => has_codex_session(cwd, home_dir),
        "gemini" => has_gemini_session(cwd, home_dir),
        _ => false,
    }
}

pub fn resume_args_for(cli_id: &str, cwd: &str, home_dir: Option<&Path>) -> Vec<String> {
    if !supports_resume(cli_id) {
        return Vec::new();
    }
    if !can_resume(cli_id, cwd, home_dir) {
        return Vec::new();
    }
    if cli_id == "opencode" {
        return opencode_resume_args(cwd, home_dir);
    }
    resume_args_unchecked(cli_id, cwd, home_dir)
}

pub fn list_session_ids(cli_id: &str, cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    match cli_id {
        "claude" => list_claude_session_ids(cwd, home_dir),
        "cursor" => list_cursor_session_ids(cwd, home_dir),
        "pi" => list_pi_session_ids(cwd, home_dir),
        "opencode" => list_opencode_session_ids(cwd, home_dir),
        "codex" => list_codex_session_ids(cwd, home_dir),
        "gemini" => list_gemini_session_ids(cwd, home_dir),
        _ => Vec::new(),
    }
}

/// True if this id is still a real on-disk session for cwd (not an empty shell).
pub fn session_id_exists(
    cli_id: &str,
    cwd: &str,
    cli_session_id: &str,
    home_dir: Option<&Path>,
) -> bool {
    let id = cli_session_id.trim();
    if id.is_empty() {
        return false;
    }
    list_session_ids(cli_id, cwd, home_dir)
        .iter()
        .any(|e| e.id == id)
}

/// Prefer newest entry whose id is not in `used_ids`.
pub fn pick_newest_unbound(entries: &[SessionEntry], used_ids: &HashSet<String>) -> Option<String> {
    for e in entries {
        if !e.id.is_empty() && !used_ids.contains(&e.id) {
            return Some(e.id.clone());
        }
    }
    None
}

/// After `/clear` / `/new`, CLIs often create a newer on-disk session while SeMa
/// still holds the pre-clear `cliSessionId`. If the newest id not in `exclude_ids`
/// differs from `current_id`, return it so the pane can follow the rotation.
///
/// `entries` must be newest-first (as from `list_session_ids`).
pub fn follow_rotated_session(
    entries: &[SessionEntry],
    current_id: &str,
    exclude_ids: &[String],
) -> Option<String> {
    let current = current_id.trim();
    if current.is_empty() {
        return None;
    }
    let exclude: HashSet<&str> = exclude_ids.iter().map(|s| s.as_str()).collect();
    for e in entries {
        if e.id.is_empty() || exclude.contains(e.id.as_str()) {
            continue;
        }
        if e.id == current {
            return None;
        }
        return Some(e.id.clone());
    }
    None
}

/// Bind the session *this pane* created: among ids that did not exist at spawn
/// (and are not claimed by other panes), pick the **oldest** new one.
pub fn pick_created_since(
    entries: &[SessionEntry],
    known_before: &[String],
    exclude_ids: &[String],
) -> Option<String> {
    let known: HashSet<&str> = known_before.iter().map(|s| s.as_str()).collect();
    let exclude: HashSet<&str> = exclude_ids.iter().map(|s| s.as_str()).collect();
    let mut created: Vec<&SessionEntry> = Vec::new();
    for e in entries {
        if e.id.is_empty() {
            continue;
        }
        if known.contains(e.id.as_str()) {
            continue;
        }
        if exclude.contains(e.id.as_str()) {
            continue;
        }
        created.push(e);
    }
    if created.is_empty() {
        return None;
    }
    // entries are newest-first → last candidate is the oldest new session
    Some(created[created.len() - 1].id.clone())
}

/// Choose resume argv for ↻ / respawn.
/// Prefer bound id; else newest session not in excludeIds; then last-in-cwd flags.
pub fn resolve_resume_selection(
    cli_id: &str,
    cwd: &str,
    opts: &ResumeOpts,
    home_dir: Option<&Path>,
) -> ResumeSelection {
    if !opts.resume {
        return ResumeSelection {
            args: Vec::new(),
            resolved_id: None,
            used_bound: false,
        };
    }

    let mut exclude: HashSet<String> = HashSet::new();
    for id in &opts.exclude_ids {
        let t = id.trim();
        if !t.is_empty() {
            exclude.insert(t.to_string());
        }
    }
    for id in &opts.claimed_ids {
        let t = id.trim();
        if !t.is_empty() {
            exclude.insert(t.to_string());
        }
    }

    let bound = opts
        .cli_session_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    if !bound.is_empty()
        && !exclude.contains(&bound)
        && session_id_exists(cli_id, cwd, &bound, home_dir)
    {
        let by_id = resume_args_for_id(cli_id, Some(&bound));
        if !by_id.is_empty() {
            return ResumeSelection {
                args: by_id,
                resolved_id: Some(bound),
                used_bound: true,
            };
        }
    }

    let listed = list_session_ids(cli_id, cwd, home_dir);
    if let Some(picked) = pick_newest_unbound(&listed, &exclude) {
        let by_id = resume_args_for_id(cli_id, Some(&picked));
        if !by_id.is_empty() {
            return ResumeSelection {
                args: by_id,
                resolved_id: Some(picked),
                used_bound: false,
            };
        }
    }

    ResumeSelection {
        args: resume_args_unchecked(cli_id, cwd, home_dir),
        resolved_id: None,
        used_bound: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_newest_unbound_skips_used() {
        let entries = vec![
            SessionEntry {
                id: "a".into(),
                mtime_ms: 3.0,
            },
            SessionEntry {
                id: "b".into(),
                mtime_ms: 2.0,
            },
            SessionEntry {
                id: "c".into(),
                mtime_ms: 1.0,
            },
        ];
        let used = HashSet::from(["a".to_string()]);
        assert_eq!(pick_newest_unbound(&entries, &used).as_deref(), Some("b"));
        let used_all = HashSet::from(["a".to_string()]);
        assert_eq!(
            pick_newest_unbound(
                &[SessionEntry {
                    id: "a".into(),
                    mtime_ms: 1.0
                }],
                &used_all
            ),
            None
        );
    }

    #[test]
    fn follow_rotated_after_clear() {
        let entries = vec![
            SessionEntry {
                id: "new-after-clear".into(),
                mtime_ms: 2.0,
            },
            SessionEntry {
                id: "old-bound".into(),
                mtime_ms: 1.0,
            },
        ];
        assert_eq!(
            follow_rotated_session(&entries, "old-bound", &[]).as_deref(),
            Some("new-after-clear")
        );
        assert_eq!(
            follow_rotated_session(&entries, "new-after-clear", &[]),
            None
        );
        // Sibling owns the newest — stay on our older binding.
        assert_eq!(
            follow_rotated_session(
                &entries,
                "old-bound",
                &["new-after-clear".into()]
            ),
            None
        );
        assert_eq!(follow_rotated_session(&entries, "", &[]), None);
    }

    #[test]
    fn pick_created_since_oldest_new() {
        let entries = vec![
            SessionEntry {
                id: "B".into(),
                mtime_ms: 2.0,
            },
            SessionEntry {
                id: "A".into(),
                mtime_ms: 1.0,
            },
        ];
        assert_eq!(
            pick_created_since(&entries, &[], &[]).as_deref(),
            Some("A")
        );
        assert_eq!(
            pick_created_since(&entries, &["A".into()], &[]).as_deref(),
            Some("B")
        );
        assert_eq!(
            pick_created_since(&entries, &[], &["A".into()]).as_deref(),
            Some("B")
        );
        assert_eq!(
            pick_created_since(
                &[SessionEntry {
                    id: "A".into(),
                    mtime_ms: 1.0
                }],
                &["A".into()],
                &[]
            ),
            None
        );
    }

    #[test]
    fn resolve_without_resume_flag_empty() {
        let sel = resolve_resume_selection(
            "claude",
            "/tmp/x",
            &ResumeOpts {
                resume: false,
                ..Default::default()
            },
            None,
        );
        assert!(sel.args.is_empty());
        assert!(sel.resolved_id.is_none());
        assert!(!sel.used_bound);
    }
}
