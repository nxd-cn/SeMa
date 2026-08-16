//! Path candidates, Windows normalize, and cwd key variants.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

/// Resolve like Node `path.resolve` (absolute; does not require existence).
pub fn path_resolve(cwd: &str) -> PathBuf {
    let p = if cwd.is_empty() {
        PathBuf::new()
    } else {
        PathBuf::from(cwd)
    };
    let abs = if p.is_absolute() {
        p
    } else {
        let mut base = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        if !cwd.is_empty() {
            base.push(cwd);
        }
        base
    };
    normalize_dot_dot(&abs)
}

/// Collapse `.` / `..` without requiring the path to exist.
fn normalize_dot_dot(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

/// Strip Windows `\\?\` prefix from canonicalize results.
fn strip_extended_prefix(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // Also handle \\?\UNC\server\share → \\server\share
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
    }
    p
}

/// Resolved cwd paths to probe for on-disk session stores.
/// On macOS, CLIs often key by realpath (`/var` → `/private/var`); Windows
/// typically has resolve === realpath — extra candidate is a no-op.
pub fn cwd_path_candidates(cwd: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut add = |p: String| {
        if p.is_empty() || seen.contains(&p) {
            return;
        }
        seen.insert(p.clone());
        out.push(p);
    };

    let abs = path_resolve(cwd);
    add(path_to_string(&abs));

    if let Ok(real) = std::fs::canonicalize(&abs) {
        add(path_to_string(&strip_extended_prefix(real)));
    }
    out
}

pub fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Path string variants for substring / DB matching (incl. Windows `\` vs `/`).
pub fn path_variants(cwd: &str) -> Vec<String> {
    let mut set: HashSet<String> = HashSet::new();
    for abs in cwd_path_candidates(cwd) {
        let fwd = abs.replace('\\', "/");
        // JSONL/JSON often escapes backslashes (C:\\Users\\...)
        let esc = abs.replace('\\', "\\\\");
        for v in [
            abs.clone(),
            fwd.clone(),
            esc.clone(),
            abs.to_lowercase(),
            fwd.to_lowercase(),
            esc.to_lowercase(),
        ] {
            set.insert(v);
        }
    }
    set.into_iter().collect()
}

pub fn normalize_dir_key(p: &str) -> String {
    p.replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

pub fn directory_match_keys(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for v in path_variants(cwd) {
        let k = normalize_dir_key(&v);
        if seen.insert(k.clone()) {
            out.push(k);
        }
    }
    out
}

pub fn home_or(home_dir: Option<&Path>) -> PathBuf {
    home_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| {
            dirs_home().unwrap_or_else(|| PathBuf::from("."))
        })
}

fn dirs_home() -> Option<PathBuf> {
    // Avoid extra crate; mirror Node os.homedir()
    if let Ok(h) = std::env::var("HOME") {
        if !h.is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    #[cfg(windows)]
    {
        if let Ok(h) = std::env::var("USERPROFILE") {
            if !h.is_empty() {
                return Some(PathBuf::from(h));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_dir_key_strips_slash_and_lowercases() {
        assert_eq!(
            normalize_dir_key(r"C:\Users\Foo\"),
            "c:/users/foo"
        );
        assert_eq!(normalize_dir_key("/Var/Folders/x/"), "/var/folders/x");
    }

    #[test]
    fn path_variants_include_forward_slash() {
        let cwd = if cfg!(windows) {
            r"C:\proj\SeMa"
        } else {
            "/Users/test/proj"
        };
        let vars = path_variants(cwd);
        assert!(vars.iter().any(|v| v.contains('/')));
    }
}
