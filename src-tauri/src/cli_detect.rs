//! CLI catalog and PATH detection.

use std::path::Path;

use serde::Serialize;

use crate::spawn::resolve_command;

#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub id: String,
    pub label: String,
    pub command: String,
    pub path: String,
}

struct CatalogEntry {
    id: &'static str,
    label: &'static str,
    candidates: &'static [&'static str],
}

const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "claude",
        label: "Claude Code",
        candidates: &["claude"],
    },
    CatalogEntry {
        id: "opencode",
        label: "OpenCode",
        candidates: &["opencode"],
    },
    CatalogEntry {
        id: "kimi",
        label: "Kimi Code",
        candidates: &["kimi"],
    },
    CatalogEntry {
        id: "cursor",
        label: "Cursor Agent",
        candidates: &["cursor-agent", "cursor"],
    },
    CatalogEntry {
        id: "codex",
        label: "Codex",
        candidates: &["codex"],
    },
    CatalogEntry {
        id: "gemini",
        label: "Gemini",
        candidates: &["gemini"],
    },
    CatalogEntry {
        id: "pi",
        label: "Pi",
        candidates: &["pi"],
    },
];

/// Built-in shell PTY — always available; platform-specific binary.
#[cfg(windows)]
fn terminal_tool() -> ToolInfo {
    let path = windows_cmd_path();
    ToolInfo {
        id: "terminal".into(),
        label: "Terminal".into(),
        command: "cmd".into(),
        path,
    }
}

#[cfg(windows)]
fn windows_cmd_path() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| {
        std::env::var("SystemRoot")
            .map(|root| format!(r"{root}\System32\cmd.exe"))
            .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into())
    })
}

#[cfg(not(windows))]
fn terminal_tool() -> ToolInfo {
    let (path, command) = unix_login_shell();
    ToolInfo {
        id: "terminal".into(),
        label: "Terminal".into(),
        command,
        path,
    }
}

/// Prefer `$SHELL`, then `/bin/zsh`, then `/bin/bash`.
#[cfg(not(windows))]
fn unix_login_shell() -> (String, String) {
    if let Ok(shell) = std::env::var("SHELL") {
        let trimmed = shell.trim();
        if !trimmed.is_empty() && Path::new(trimmed).is_file() {
            let name = Path::new(trimmed)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("sh")
                .to_string();
            return (trimmed.to_string(), name);
        }
    }
    if Path::new("/bin/zsh").is_file() {
        return ("/bin/zsh".into(), "zsh".into());
    }
    ("/bin/bash".into(), "bash".into())
}

pub fn detect_tools() -> Vec<ToolInfo> {
    let mut tools = Vec::new();
    for entry in CATALOG {
        for name in entry.candidates {
            if let Some(path) = resolve_command(name) {
                tools.push(ToolInfo {
                    id: entry.id.to_string(),
                    label: entry.label.to_string(),
                    command: (*name).to_string(),
                    path,
                });
                break;
            }
        }
    }
    tools.push(terminal_tool());
    tools
}

pub fn tool_for_id<'a>(tools: &'a [ToolInfo], cli_id: &str) -> Option<&'a ToolInfo> {
    tools.iter().find(|t| t.id == cli_id)
}

pub fn sort_tools_by_usage(
    tools: &[ToolInfo],
    counts: &std::collections::HashMap<String, u64>,
) -> Vec<ToolInfo> {
    let mut indexed: Vec<(usize, &ToolInfo)> = tools.iter().enumerate().collect();
    indexed.sort_by(|(ia, a), (ib, b)| {
        let ca = counts.get(&a.id).copied().unwrap_or(0);
        let cb = counts.get(&b.id).copied().unwrap_or(0);
        cb.cmp(&ca).then_with(|| ia.cmp(ib))
    });
    indexed.into_iter().map(|(_, t)| t.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_includes_terminal() {
        let tools = detect_tools();
        let terminal = tools.iter().find(|t| t.id == "terminal").expect("terminal");
        assert!(!terminal.path.is_empty());
        assert!(!terminal.command.is_empty());
        #[cfg(windows)]
        {
            assert_eq!(terminal.command, "cmd");
            assert!(
                terminal.path.to_ascii_lowercase().ends_with("cmd.exe"),
                "expected cmd.exe, got {}",
                terminal.path
            );
        }
        #[cfg(not(windows))]
        {
            assert!(
                terminal.path.starts_with('/'),
                "expected unix shell path, got {}",
                terminal.path
            );
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_login_shell_fallback_order() {
        let (path, command) = unix_login_shell();
        assert!(Path::new(&path).is_file(), "shell path must exist: {path}");
        assert!(!command.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_cmd_path_non_empty() {
        let path = windows_cmd_path();
        assert!(!path.is_empty());
        assert!(path.to_ascii_lowercase().contains("cmd"));
    }
}
