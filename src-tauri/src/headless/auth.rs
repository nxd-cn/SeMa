//! Account login / status for CLIs that use OAuth (e.g. Cursor), not API-key forms.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::cli_detect::{detect_tool_by_id, tool_for_id, ToolInfo};
use crate::spawn::spawn_target;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub cli_id: String,
    /// `api_key` | `oauth` | `unknown` | `none`
    pub kind: String,
    pub logged_in: Option<bool>,
    pub detail: String,
    pub login_supported: bool,
}

fn tool_from_state(state: &AppState, cli_id: &str) -> Option<ToolInfo> {
    let tools = state.tools.lock();
    tool_for_id(&tools, cli_id)
        .cloned()
        .or_else(|| detect_tool_by_id(cli_id))
}

/// Login / status subcommands when known.
pub fn auth_login_argv(cli_id: &str) -> Option<Vec<String>> {
    match cli_id {
        "cursor" => Some(vec!["login".into()]),
        "claude" => Some(vec!["auth".into(), "login".into()]),
        "opencode" => Some(vec!["auth".into(), "login".into()]),
        "gemini" => Some(vec!["auth".into()]),
        "codex" => Some(vec!["login".into()]),
        // kimi / pi: often env/API key — no stable login argv
        _ => None,
    }
}

fn auth_status_argv(cli_id: &str) -> Option<Vec<String>> {
    match cli_id {
        "cursor" => Some(vec!["status".into()]),
        "claude" => Some(vec!["auth".into(), "status".into()]),
        "opencode" => Some(vec!["auth".into(), "list".into()]),
        _ => None,
    }
}

fn auth_kind(cli_id: &str) -> &'static str {
    match cli_id {
        "cursor" | "claude" | "codex" | "gemini" => "oauth",
        "opencode" | "kimi" | "pi" => "api_key",
        _ => "unknown",
    }
}

pub fn auth_status(state: &AppState, cli_id: &str) -> AuthStatus {
    let tool = tool_from_state(state, cli_id);
    auth_status_for_tool(cli_id, tool.as_ref())
}

pub fn auth_status_for_tool(cli_id: &str, tool: Option<&ToolInfo>) -> AuthStatus {
    let login_supported = auth_login_argv(cli_id).is_some();
    let kind = auth_kind(cli_id).to_string();
    let Some(tool) = tool else {
        return AuthStatus {
            cli_id: cli_id.to_string(),
            kind,
            logged_in: None,
            detail: "CLI 未安装或不在 PATH".into(),
            login_supported,
        };
    };
    let Some(status_args) = auth_status_argv(cli_id) else {
        return AuthStatus {
            cli_id: cli_id.to_string(),
            kind,
            logged_in: None,
            detail: "无 status 命令；发消息失败时再提示登录或配 Key".into(),
            login_supported,
        };
    };
    match run_capture(tool, &status_args, None) {
        Ok((code, stdout, stderr)) => {
            let text = format!("{stdout}\n{stderr}").to_ascii_lowercase();
            let logged_in = infer_logged_in(cli_id, code, &text);
            AuthStatus {
                cli_id: cli_id.to_string(),
                kind,
                logged_in,
                detail: trim_detail(&stdout, &stderr),
                login_supported,
            }
        }
        Err(e) => AuthStatus {
            cli_id: cli_id.to_string(),
            kind,
            logged_in: None,
            detail: e,
            login_supported,
        },
    }
}

fn infer_logged_in(cli_id: &str, code: i32, text: &str) -> Option<bool> {
    if text.contains("not logged")
        || text.contains("not authenticated")
        || text.contains("please log in")
        || text.contains("login required")
        || text.contains("unauthorized")
    {
        return Some(false);
    }
    if text.contains("logged in")
        || text.contains("authenticated")
        || (cli_id == "cursor" && text.contains("email"))
    {
        return Some(true);
    }
    if code == 0 {
        return Some(true);
    }
    if code != 0 {
        return Some(false);
    }
    None
}

fn trim_detail(stdout: &str, stderr: &str) -> String {
    let s = if !stdout.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    let mut t = s.chars().take(400).collect::<String>();
    if s.chars().count() > 400 {
        t.push('…');
    }
    t
}

/// Spawn login (opens browser when CLI supports it). Does not wait for full OAuth.
pub fn spawn_login(state: &AppState, cli_id: &str, cwd: Option<&str>) -> Result<(), String> {
    let args = auth_login_argv(cli_id).ok_or_else(|| format!("{cli_id} 不支持一键登录命令"))?;
    let tool = tool_from_state(state, cli_id).ok_or_else(|| format!("未找到 CLI: {cli_id}"))?;
    let target = spawn_target(&tool.path, &tool.command, &args);
    let mut cmd = Command::new(&target.file);
    cmd.args(&target.args);
    if let Some(dir) = cwd {
        if Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }
    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        // Allow browser; keep console hidden.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动登录失败: {e}"))?;
    Ok(())
}

pub(crate) fn run_capture(
    tool: &ToolInfo,
    extra_args: &[String],
    cwd: Option<&Path>,
) -> Result<(i32, String, String), String> {
    let target = spawn_target(&tool.path, &tool.command, extra_args);
    let mut cmd = Command::new(&target.file);
    cmd.args(&target.args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("执行失败: {e}"))?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_login_argv() {
        assert_eq!(auth_login_argv("cursor"), Some(vec!["login".into()]));
        assert!(auth_login_argv("pi").is_none());
    }

    #[test]
    fn infer_not_logged_in() {
        assert_eq!(
            infer_logged_in("cursor", 1, "error: not logged in"),
            Some(false)
        );
    }
}
