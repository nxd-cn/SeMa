//! PATH resolve and spawn target selection (port of spawn-helpers.js).

use std::process::Command;

/// Win32 `CREATE_NO_WINDOW` — hide console flashes for GUI-spawned `where` / `cmd`.
/// Matches Electron `windowsHide: true`. Do not apply on macOS/Unix.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct SpawnTarget {
    pub file: String,
    pub args: Vec<String>,
}

pub fn pick_win_executable(lines: &[String]) -> Option<String> {
    let list: Vec<String> = lines
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    list.iter()
        .find(|p| {
            let lower = p.to_ascii_lowercase();
            lower.ends_with(".cmd") || lower.ends_with(".exe") || lower.ends_with(".bat")
        })
        .cloned()
        .or_else(|| list.first().cloned())
}

pub fn pick_unix_executable(lines: &[String]) -> Option<String> {
    lines
        .iter()
        .map(|s| s.trim().to_string())
        .find(|s| !s.is_empty())
}

pub fn resolve_command(name: &str) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // GUI subsystem + console `where.exe` without this flag → black console flash.
        let output = Command::new("where")
            .arg(name)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
        return pick_win_executable(&lines);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("which").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
        pick_unix_executable(&lines)
    }
}

/// Build file + args for portable-pty CommandBuilder.
pub fn spawn_target(tool_path: &str, tool_command: &str, extra_args: &[String]) -> SpawnTarget {
    let extra: Vec<String> = extra_args
        .iter()
        .cloned()
        .filter(|s| !s.is_empty())
        .collect();
    #[cfg(windows)]
    {
        let lower = tool_path.to_ascii_lowercase();
        if !(lower.ends_with(".exe") || lower.ends_with(".cmd") || lower.ends_with(".bat")) {
            let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
            let mut parts = vec![tool_command.to_string()];
            parts.extend(extra);
            let cmdline = parts.join(" ");
            return SpawnTarget {
                file: comspec,
                args: vec!["/d".into(), "/s".into(), "/c".into(), cmdline],
            };
        }
        return SpawnTarget {
            file: tool_path.to_string(),
            args: extra,
        };
    }
    #[cfg(not(windows))]
    {
        let _ = tool_command;
        SpawnTarget {
            file: tool_path.to_string(),
            args: extra,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_prefers_cmd() {
        let lines = vec![r"C:\npm\claude".into(), r"C:\npm\claude.cmd".into()];
        assert_eq!(
            pick_win_executable(&lines).as_deref(),
            Some(r"C:\npm\claude.cmd")
        );
    }

    #[test]
    fn unix_first_line() {
        let lines = vec!["/opt/homebrew/bin/claude".into()];
        assert_eq!(
            pick_unix_executable(&lines).as_deref(),
            Some("/opt/homebrew/bin/claude")
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolve_where_self_with_no_window_flag() {
        // Smoke: CREATE_NO_WINDOW must not break PATH resolve (where.exe → itself).
        let path = resolve_command("where").expect("where.exe should resolve on Windows");
        let lower = path.to_ascii_lowercase();
        assert!(
            lower.ends_with("where.exe") || lower.ends_with("\\where"),
            "unexpected where path: {path}"
        );
    }
}
