//! Static resume argv maps and by-id builders.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use super::kimi::kimi_resume_args;
use super::opencode::opencode_resume_args;

fn resume_args_map() -> &'static HashMap<&'static str, Vec<&'static str>> {
    static MAP: OnceLock<HashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    MAP.get_or_init(|| {
        HashMap::from([
            ("claude", vec!["--continue"]),
            ("cursor", vec!["--continue"]),
            // opencode: resolved dynamically
            ("opencode", vec![]),
            ("kimi", vec!["--continue"]),
            ("pi", vec!["--continue"]),
            ("codex", vec!["resume", "--last"]),
            ("gemini", vec!["--resume"]),
        ])
    })
}

pub fn supports_resume(cli_id: &str) -> bool {
    resume_args_map().contains_key(cli_id)
}

pub fn resume_args_for_id(cli_id: &str, cli_session_id: Option<&str>) -> Vec<String> {
    let id = cli_session_id.map(str::trim).unwrap_or("").to_string();
    if id.is_empty() {
        return Vec::new();
    }
    match cli_id {
        "claude" => vec!["--resume".into(), id],
        "cursor" => vec!["--resume".into(), id],
        "pi" => vec!["--session".into(), id],
        "opencode" => vec!["--session".into(), id],
        "kimi" => vec!["--session".into(), id],
        "codex" => vec!["resume".into(), id],
        "gemini" => vec!["--resume".into(), id],
        _ => Vec::new(),
    }
}

/// Resume argv for known CLIs (manual「继续上次」). OpenCode / Kimi need cwd for `--session`.
pub fn resume_args_unchecked(cli_id: &str, cwd: &str, home_dir: Option<&Path>) -> Vec<String> {
    if !supports_resume(cli_id) {
        return Vec::new();
    }
    if cli_id == "opencode" {
        return opencode_resume_args(cwd, home_dir);
    }
    if cli_id == "kimi" {
        return kimi_resume_args(cwd, home_dir);
    }
    resume_args_map()
        .get(cli_id)
        .map(|v| v.iter().map(|s| (*s).to_string()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_args_for_id_by_cli() {
        assert_eq!(
            resume_args_for_id("claude", Some("abc-123")),
            vec!["--resume", "abc-123"]
        );
        assert_eq!(
            resume_args_for_id("opencode", Some("sess-1")),
            vec!["--session", "sess-1"]
        );
        assert_eq!(
            resume_args_for_id("cursor", Some("chat-uuid-1")),
            vec!["--resume", "chat-uuid-1"]
        );
        assert_eq!(
            resume_args_for_id("pi", Some("019f827d-c503-75ad-838a-46d5f0b9abfe")),
            vec!["--session", "019f827d-c503-75ad-838a-46d5f0b9abfe"]
        );
        assert_eq!(
            resume_args_for_id("codex", Some("7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab")),
            vec!["resume", "7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab"]
        );
        assert_eq!(
            resume_args_for_id("gemini", Some("a1b2c3d4-e5f6-7890-abcd-ef1234567890")),
            vec!["--resume", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
        );
        assert_eq!(
            resume_args_for_id("kimi", Some("kid-1")),
            vec!["--session", "kid-1"]
        );
        assert!(supports_resume("kimi"));
        assert!(resume_args_for_id("terminal", Some("x")).is_empty());
        assert!(resume_args_for_id("claude", Some("")).is_empty());
        assert!(resume_args_for_id("claude", None).is_empty());
    }
}
