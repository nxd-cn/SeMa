//! Read-only git branch for pane footer (Windows / macOS).

use std::path::Path;
use std::process::Command;

use crate::spawn::resolve_command;

pub const BRANCH_FALLBACK: &str = "~";

/// Normalize `git rev-parse --abbrev-ref HEAD` stdout for display.
pub fn normalize_branch_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    if name.is_empty() {
        return None;
    }
    // Detached HEAD is not a branch name; caller may substitute short SHA.
    if name == "HEAD" {
        return None;
    }
    Some(name.to_string())
}

fn run_git(git_path: &str, args: &[String]) -> Option<std::process::Output> {
    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        let lower = git_path.to_ascii_lowercase();
        let mut cmd = if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            // CreateProcess cannot run .cmd/.bat directly; use cmd.exe like spawn.rs.
            let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
            let mut parts = Vec::with_capacity(1 + args.len());
            parts.push(git_path.to_string());
            parts.extend(args.iter().cloned());
            let cmdline = parts
                .iter()
                .map(|a| {
                    if a.is_empty() {
                        "\"\"".to_string()
                    } else if a.chars().any(|c| c.is_whitespace() || c == '"') {
                        format!("\"{}\"", a.replace('"', "\"\""))
                    } else {
                        a.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            let mut c = Command::new(comspec);
            c.args(["/d", "/s", "/c", &cmdline]);
            c
        } else {
            let mut c = Command::new(git_path);
            c.args(args);
            c
        };
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().ok()
    }
    #[cfg(not(windows))]
    {
        Command::new(git_path).args(args).output().ok()
    }
}

fn git_stdout(git_path: &str, cwd: &str, git_args: &[&str]) -> Option<String> {
    let mut args = Vec::with_capacity(2 + git_args.len());
    args.push("-C".to_string());
    args.push(cwd.to_string());
    args.extend(git_args.iter().map(|s| (*s).to_string()));
    let out = run_git(git_path, &args)?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn current_branch_inner(cwd: &str) -> String {
    let path = Path::new(cwd);
    if cwd.trim().is_empty() || !path.is_dir() {
        return BRANCH_FALLBACK.to_string();
    }
    // No git / broken PATH / where|which failed → never error out to the UI.
    let Some(git) = resolve_command("git") else {
        return BRANCH_FALLBACK.to_string();
    };

    if let Some(raw) = git_stdout(&git, cwd, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        if let Some(name) = normalize_branch_name(&raw) {
            return name;
        }
        // Detached HEAD: show short SHA instead of littering the footer with HEAD.
        if let Some(sha) = git_stdout(&git, cwd, &["rev-parse", "--short", "HEAD"]) {
            return sha;
        }
    }
    BRANCH_FALLBACK.to_string()
}

/// Current branch for `cwd`, or [`BRANCH_FALLBACK`] when unavailable.
///
/// Never panics: missing git, failed spawn, non-repo, timeout callers, etc.
/// all surface as `~`. Uses `where`/`which` via [`resolve_command`] on both
/// Windows and macOS.
pub fn current_branch(cwd: &str) -> String {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| current_branch_inner(cwd)))
        .unwrap_or_else(|_| BRANCH_FALLBACK.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_branch() {
        assert_eq!(normalize_branch_name("  main\n"), Some("main".to_string()));
        assert_eq!(
            normalize_branch_name("feature/foo"),
            Some("feature/foo".to_string())
        );
    }

    #[test]
    fn normalize_rejects_empty_and_detached() {
        assert_eq!(normalize_branch_name(""), None);
        assert_eq!(normalize_branch_name("   "), None);
        assert_eq!(normalize_branch_name("HEAD"), None);
        assert_eq!(normalize_branch_name(" HEAD "), None);
    }

    #[test]
    fn missing_dir_is_fallback() {
        assert_eq!(current_branch(""), BRANCH_FALLBACK);
        assert_eq!(
            current_branch("/path/that/does/not/exist-sema-git"),
            BRANCH_FALLBACK
        );
    }
}
