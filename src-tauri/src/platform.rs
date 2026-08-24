//! Platform-specific PATH enrichment and identity helpers.

use std::env;
use std::path::{Path, PathBuf};

/// Directories prepended to PATH for Mac/Linux GUI launches (no shell profile).
/// Includes OpenCode's official installer defaults (`curl … | bash` →
/// `~/.opencode/bin`, or `~/bin` when that dir is preferred).
#[cfg(not(windows))]
pub(crate) fn gui_path_extras(home: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local/bin"),
        home.join(".npm-global/bin"),
        home.join("bin"),
        home.join(".opencode/bin"),
        home.join(".kimi-code/bin"),
    ]
}

#[cfg(not(windows))]
pub fn enrich_path_for_gui_launch() {
    let home = dirs::home_dir().unwrap_or_default();
    let extras = gui_path_extras(&home);
    let path = env::var_os("PATH").unwrap_or_default();
    let mut parts: Vec<PathBuf> = env::split_paths(&path).collect();
    let mut seen: std::collections::HashSet<PathBuf> = parts.iter().cloned().collect();
    let mut prepend = Vec::new();
    for dir in extras {
        if dir.is_dir() && !seen.contains(&dir) {
            prepend.push(dir.clone());
            seen.insert(dir);
        }
    }
    if !prepend.is_empty() {
        prepend.append(&mut parts);
        if let Ok(joined) = env::join_paths(prepend) {
            env::set_var("PATH", joined);
        }
    }
}

#[cfg(windows)]
pub fn enrich_path_for_gui_launch() {
    // Windows: do not alter PATH (parity with Electron).
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn folder_name(cwd: &str) -> String {
    let p = Path::new(cwd);
    p.file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("home")
        .to_string()
}

pub const WINDOWS_AUMID: &str = "com.sema.app";

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn gui_path_extras_includes_opencode_installer_dirs() {
        let home = Path::new("/Users/demo");
        let extras = gui_path_extras(home);
        assert!(
            extras.iter().any(|p| p.ends_with(".opencode/bin")),
            "official curl installer defaults to ~/.opencode/bin; got {extras:?}"
        );
        assert!(
            extras.iter().any(|p| p == &home.join("bin")),
            "installer may use ~/bin; got {extras:?}"
        );
    }

    #[test]
    fn gui_path_extras_includes_kimi_code_bin() {
        let home = Path::new("/Users/demo");
        let extras = gui_path_extras(home);
        assert!(
            extras.iter().any(|p| p == &home.join(".kimi-code/bin")),
            "official kimi installer uses ~/.kimi-code/bin; got {extras:?}"
        );
    }
}
