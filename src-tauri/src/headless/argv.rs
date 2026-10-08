//! Per-CLI headless argv (prompt / session / model / trust).
//! Flags verified against local `--help` where possible; others follow public CLI docs.

use crate::trust_args::trust_args_for;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApprovalMode {
    #[default]
    Auto,
    Ask,
}

impl ApprovalMode {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "ask" | "manual" => Self::Ask,
            _ => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct HeadlessOpts {
    pub prompt: String,
    pub session_id: Option<String>,
    /// Continue last-in-cwd when no session id (CLI-specific).
    pub continue_last: bool,
    pub model: Option<String>,
    pub approval: ApprovalMode,
}

/// Workspace-trust flags only (not tool auto-approve).
fn workspace_trust_args(cli_id: &str) -> Vec<String> {
    match cli_id {
        "cursor" => vec!["--trust".into()],
        "gemini" => vec!["--skip-trust".into()],
        _ => Vec::new(),
    }
}

/// Build argv **after** the executable (and after Windows `cmd /c` wrapping via spawn_target).
pub fn headless_argv(cli_id: &str, opts: &HeadlessOpts) -> Vec<String> {
    let mut args = if opts.approval == ApprovalMode::Ask {
        workspace_trust_args(cli_id)
    } else {
        trust_args_for(cli_id)
    };
    match cli_id {
        "claude" => push_claude(&mut args, opts),
        "cursor" => push_cursor(&mut args, opts),
        "opencode" => push_opencode(&mut args, opts),
        "pi" => push_pi(&mut args, opts),
        "gemini" => push_gemini(&mut args, opts),
        "codex" => push_codex(&mut args, opts),
        "kimi" => push_kimi(&mut args, opts),
        _ => {
            args.push("-p".into());
            args.push(opts.prompt.clone());
        }
    }
    args
}

fn push_claude(args: &mut Vec<String>, opts: &HeadlessOpts) {
    if opts.approval == ApprovalMode::Auto {
        args.push("--dangerously-skip-permissions".into());
    } else {
        args.push("--permission-prompts".into());
        args.push("host".into());
        args.push("--input-format".into());
        args.push("stream-json".into());
    }
    args.push("-p".into());
    // Claude: --print + stream-json requires --verbose; partials need
    // --include-partial-messages or we only get the final assistant blob.
    args.push("--verbose".into());
    args.push("--output-format".into());
    args.push("stream-json".into());
    args.push("--include-partial-messages".into());
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        args.push("-c".into());
    }
    args.push(opts.prompt.clone());
}

fn push_cursor(args: &mut Vec<String>, opts: &HeadlessOpts) {
    if opts.approval == ApprovalMode::Auto {
        args.push("--force".into());
    }
    args.push("-p".into());
    args.push("--output-format".into());
    args.push("stream-json".into());
    args.push("--stream-partial-output".into());
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        args.push("--continue".into());
    }
    args.push(opts.prompt.clone());
}

fn push_opencode(args: &mut Vec<String>, opts: &HeadlessOpts) {
    args.push("run".into());
    if opts.approval == ApprovalMode::Auto {
        args.push("--auto".into());
    }
    args.push("--format".into());
    args.push("json".into());
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("-m".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        // Prefer long form — matches resume/ and OpenCode docs.
        args.push("--session".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        // Windows: --continue ok. macOS OpenCode --continue is unreliable
        // (see resume/opencode.rs); still pass when caller has no id yet.
        args.push("--continue".into());
    }
    args.push(opts.prompt.clone());
}

fn push_pi(args: &mut Vec<String>, opts: &HeadlessOpts) {
    args.push("-p".into());
    if opts.approval == ApprovalMode::Auto {
        args.push("--approve".into());
    }
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--session".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        args.push("--continue".into());
    }
    args.push(opts.prompt.clone());
}

fn push_gemini(args: &mut Vec<String>, opts: &HeadlessOpts) {
    args.push("-p".into());
    if opts.approval == ApprovalMode::Auto {
        args.push("--yolo".into());
    }
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("-m".into());
        args.push(m.to_string());
    }
    // By-id: --resume <id> (resume/args.rs). No-id continue: --continue so the
    // trailing prompt is not eaten as a session id (unlike bare --resume).
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        args.push("--continue".into());
    }
    args.push(opts.prompt.clone());
}

fn push_codex(args: &mut Vec<String>, opts: &HeadlessOpts) {
    // OpenAI Codex CLI: non-interactive `exec`.
    args.push("exec".into());
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("resume".into());
        args.push(id.to_string());
        args.push(opts.prompt.clone());
        return;
    }
    if opts.continue_last {
        args.push("resume".into());
        args.push("--last".into());
        args.push(opts.prompt.clone());
        return;
    }
    args.push(opts.prompt.clone());
}

fn push_kimi(args: &mut Vec<String>, opts: &HeadlessOpts) {
    // Auto mode: trust_args already injected --yolo.
    args.push("-p".into());
    if let Some(m) = opts.model.as_deref().filter(|s| !s.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(id) = opts.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--session".into());
        args.push(id.to_string());
    } else if opts.continue_last {
        args.push("--continue".into());
    }
    args.push(opts.prompt.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_print_argv() {
        let a = headless_argv(
            "claude",
            &HeadlessOpts {
                prompt: "hi".into(),
                ..Default::default()
            },
        );
        assert!(a.contains(&"-p".into()));
        assert!(a.contains(&"hi".into()));
        assert!(a.contains(&"--dangerously-skip-permissions".into()));
        assert!(a.contains(&"--verbose".into()));
        assert!(a.contains(&"--include-partial-messages".into()));
        assert!(a.windows(2).any(|w| w == ["--output-format", "stream-json"]));
    }

    #[test]
    fn cursor_print_resume() {
        let a = headless_argv(
            "cursor",
            &HeadlessOpts {
                prompt: "hi".into(),
                session_id: Some("abc".into()),
                ..Default::default()
            },
        );
        assert!(a.windows(2).any(|w| w == ["--resume", "abc"]));
        assert!(a.contains(&"-p".into()));
        assert!(a.contains(&"--trust".into()));
        assert!(a.contains(&"--force".into()));
        assert!(a.contains(&"--stream-partial-output".into()));
        assert!(a.windows(2).any(|w| w == ["--output-format", "stream-json"]));
    }

    #[test]
    fn opencode_run_auto() {
        let a = headless_argv(
            "opencode",
            &HeadlessOpts {
                prompt: "hi".into(),
                model: Some("openai/gpt-4o".into()),
                ..Default::default()
            },
        );
        assert_eq!(a[0], "run");
        assert!(a.contains(&"--auto".into()));
        assert!(a.windows(2).any(|w| w == ["-m", "openai/gpt-4o"]));
        assert!(a.windows(2).any(|w| w == ["--format", "json"]));
    }

    #[test]
    fn pi_print_approve() {
        let a = headless_argv(
            "pi",
            &HeadlessOpts {
                prompt: "hi".into(),
                continue_last: true,
                ..Default::default()
            },
        );
        assert!(a.contains(&"-p".into()));
        assert!(a.contains(&"--approve".into()));
        assert!(a.contains(&"--continue".into()));
    }

    #[test]
    fn all_chat_clis_produce_nonempty_argv() {
        for id in ["claude", "opencode", "kimi", "cursor", "codex", "gemini", "pi"] {
            let a = headless_argv(
                id,
                &HeadlessOpts {
                    prompt: "x".into(),
                    ..Default::default()
                },
            );
            assert!(!a.is_empty(), "{id}");
            assert!(a.iter().any(|s| s == "x"), "{id} missing prompt");
        }
    }

    #[test]
    fn gemini_resume_by_id_and_continue() {
        let by_id = headless_argv(
            "gemini",
            &HeadlessOpts {
                prompt: "hi".into(),
                session_id: Some("sess-g".into()),
                ..Default::default()
            },
        );
        assert!(by_id.windows(2).any(|w| w == ["--resume", "sess-g"]));
        assert!(by_id.last().is_some_and(|s| s == "hi"));

        let cont = headless_argv(
            "gemini",
            &HeadlessOpts {
                prompt: "hi".into(),
                continue_last: true,
                ..Default::default()
            },
        );
        assert!(cont.contains(&"--continue".into()));
        assert!(cont.last().is_some_and(|s| s == "hi"));
    }

    #[test]
    fn codex_resume_last_on_continue() {
        let a = headless_argv(
            "codex",
            &HeadlessOpts {
                prompt: "hi".into(),
                continue_last: true,
                ..Default::default()
            },
        );
        assert_eq!(a[0], "exec");
        assert!(a.windows(2).any(|w| w == ["resume", "--last"]));
        assert!(a.last().is_some_and(|s| s == "hi"));
    }

    #[test]
    fn opencode_session_long_flag() {
        let a = headless_argv(
            "opencode",
            &HeadlessOpts {
                prompt: "hi".into(),
                session_id: Some("oc-1".into()),
                ..Default::default()
            },
        );
        assert!(a.windows(2).any(|w| w == ["--session", "oc-1"]));
    }
}
