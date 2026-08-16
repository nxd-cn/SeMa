//! Platform-specific PATH enrichment and identity helpers.

use std::env;
use std::path::{Path, PathBuf};

#[cfg(not(windows))]
pub fn enrich_path_for_gui_launch() {
    let home = dirs::home_dir().unwrap_or_default();
    let extras = [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local/bin"),
        home.join(".npm-global/bin"),
    ];
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
