//! Kimi Code sessions: ~/.kimi-code (or $KIMI_CODE_HOME).
//!
//! Task 2: data root, workDirKey, session_index.jsonl parse.
//! list/has/resume argv land in Task 3.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::fsutil::{mtime_ms, sort_newest_first};
use super::paths::{
    cwd_path_candidates, directory_match_keys, home_or, normalize_dir_key, path_resolve,
    path_to_string,
};
use super::types::SessionEntry;

pub fn kimi_data_root(home_dir: Option<&Path>) -> PathBuf {
    if let Ok(v) = std::env::var("KIMI_CODE_HOME") {
        let t = v.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    home_or(home_dir).join(".kimi-code")
}

/// Resolve cwd the way Kimi Code keys sessions.
/// Windows: lowercase + backslashes. Unix: resolved path as-is (forward slashes).
pub fn normalize_kimi_work_dir(cwd: &str) -> String {
    let resolved = path_to_string(&path_resolve(cwd));
    #[cfg(windows)]
    {
        resolved.replace('/', "\\").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        resolved
    }
}

fn work_dir_slug(norm: &str) -> String {
    let base = Path::new(norm)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut slug: String = base
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if slug.len() > 40 {
        slug.truncate(40);
    }
    if slug.is_empty() {
        "workspace".into()
    } else {
        slug
    }
}

pub fn kimi_work_dir_key(cwd: &str) -> String {
    let norm = normalize_kimi_work_dir(cwd);
    let slug = work_dir_slug(&norm);
    let digest = Sha256::digest(norm.as_bytes());
    let hex12: String = format!("{digest:x}").chars().take(12).collect();
    format!("wd_{slug}_{hex12}")
}

pub fn kimi_work_dir_keys(cwd: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in cwd_path_candidates(cwd) {
        let key = kimi_work_dir_key(&p);
        if seen.insert(key.clone()) {
            out.push(key);
        }
    }
    out
}

/// Parse `session_index.jsonl`: skip bad lines, last-write-wins per sessionId, apply deleted tombstones.
fn read_session_index(root: &Path) -> Vec<(String, String, String)> {
    let path = root.join("session_index.jsonl");
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut by_id: HashMap<String, (String, String)> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(id) = v
            .get("sessionId")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let deleted = v.get("deleted").and_then(|x| x.as_bool()).unwrap_or(false);
        if deleted {
            by_id.remove(id);
            order.retain(|x| x != id);
            continue;
        }
        let session_dir = v
            .get("sessionDir")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let work_dir = v
            .get("workDir")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if !by_id.contains_key(id) {
            order.push(id.to_string());
        }
        by_id.insert(id.to_string(), (session_dir, work_dir));
    }
    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id).map(|(dir, wd)| (id, dir, wd)))
        .collect()
}

fn resolve_session_dir(root: &Path, session_dir: &str) -> PathBuf {
    if session_dir.is_empty() {
        return PathBuf::new();
    }
    let p = PathBuf::from(session_dir);
    if p.is_absolute() {
        p
    } else {
        root.join(session_dir)
    }
}

fn session_dir_valid(dir: &Path) -> bool {
    !dir.as_os_str().is_empty() && dir.join("state.json").is_file()
}

fn read_state_work_dir(session_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(session_dir.join("state.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    v.get("workDir")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn work_dir_matches_cwd(work_dir: &str, cwd: &str) -> bool {
    if work_dir.is_empty() {
        return false;
    }
    let want = normalize_dir_key(work_dir);
    directory_match_keys(cwd).iter().any(|k| k == &want)
}

fn entry_mtime(dir: &Path) -> f64 {
    let state = dir.join("state.json");
    if state.is_file() {
        mtime_ms(&state)
    } else {
        mtime_ms(dir)
    }
}

pub fn find_kimi_session_dir(
    cwd: &str,
    session_id: &str,
    home_dir: Option<&Path>,
) -> Option<PathBuf> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return None;
    }
    let root = kimi_data_root(home_dir);

    for (id, session_dir, index_work_dir) in read_session_index(&root) {
        if id != session_id {
            continue;
        }
        let dir = resolve_session_dir(&root, &session_dir);
        if !session_dir_valid(&dir) {
            continue;
        }
        let work_dir = read_state_work_dir(&dir).unwrap_or(index_work_dir);
        if work_dir_matches_cwd(&work_dir, cwd) {
            return Some(dir);
        }
    }

    for key in kimi_work_dir_keys(cwd) {
        let dir = root.join("sessions").join(&key).join(session_id);
        if session_dir_valid(&dir) {
            return Some(dir);
        }
    }
    None
}

pub fn list_kimi_session_ids(cwd: &str, home_dir: Option<&Path>) -> Vec<SessionEntry> {
    let root = kimi_data_root(home_dir);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for (id, session_dir, index_work_dir) in read_session_index(&root) {
        let dir = resolve_session_dir(&root, &session_dir);
        if !session_dir_valid(&dir) {
            continue;
        }
        let work_dir = read_state_work_dir(&dir).unwrap_or(index_work_dir);
        if !work_dir_matches_cwd(&work_dir, cwd) {
            continue;
        }
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        out.push(SessionEntry {
            id,
            mtime_ms: entry_mtime(&dir),
        });
    }

    if out.is_empty() {
        for key in kimi_work_dir_keys(cwd) {
            let folder = root.join("sessions").join(&key);
            let Ok(entries) = fs::read_dir(&folder) else {
                continue;
            };
            for e in entries.flatten() {
                let dir = e.path();
                if !dir.is_dir() || !session_dir_valid(&dir) {
                    continue;
                }
                let id = e.file_name().to_string_lossy().into_owned();
                if id.is_empty() || !seen.insert(id.clone()) {
                    continue;
                }
                out.push(SessionEntry {
                    id,
                    mtime_ms: entry_mtime(&dir),
                });
            }
        }
    }

    sort_newest_first(&mut out);
    out
}

pub fn has_kimi_session(cwd: &str, home_dir: Option<&Path>) -> bool {
    !list_kimi_session_ids(cwd, home_dir).is_empty()
}

/// `--continue` on Windows and macOS (unlike OpenCode's Mac-empty fallback).
pub fn kimi_no_id_fallback() -> Vec<String> {
    vec!["--continue".into()]
}

pub fn kimi_resume_args(cwd: &str, home_dir: Option<&Path>) -> Vec<String> {
    let listed = list_kimi_session_ids(cwd, home_dir);
    if let Some(id) = listed
        .first()
        .map(|e| e.id.as_str())
        .filter(|s| !s.is_empty())
    {
        return vec!["--session".into(), id.to_string()];
    }
    // has ≡ list nonempty, so --continue is currently unreachable; kept to match brief.
    if has_kimi_session(cwd, home_dir) {
        return kimi_no_id_fallback();
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;

    #[test]
    fn work_dir_key_stable_slug_and_hash_prefix() {
        let key = kimi_work_dir_key("/tmp/My_Proj!");
        assert!(key.starts_with("wd_"), "{key}");
        let _parts: Vec<_> = key.split('_').collect();
        // slug keeps `_` (allowed); `!` → `-` → `my_proj-`
        assert!(key.starts_with("wd_my_proj-_"), "{key}");
        let hex = key.rsplit('_').next().unwrap();
        assert_eq!(hex.len(), 12, "{key}");
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn work_dir_slug_empty_is_workspace() {
        let key = kimi_work_dir_key("/");
        assert!(key.starts_with("wd_workspace_"), "{key}");
        let hex = key.rsplit('_').next().unwrap();
        assert_eq!(hex.len(), 12, "{key}");
    }

    #[test]
    fn work_dir_slug_truncates_to_forty() {
        let long = "a".repeat(50);
        let cwd = format!("/tmp/{long}");
        let key = kimi_work_dir_key(&cwd);
        let rest = key.strip_prefix("wd_").expect(&key);
        let (slug, hex) = rest.rsplit_once('_').expect(&key);
        assert_eq!(slug.len(), 40, "{key}");
        assert_eq!(slug, "a".repeat(40));
        assert_eq!(hex.len(), 12, "{key}");
    }

    #[test]
    fn work_dir_keys_include_primary_and_are_unique() {
        let keys = kimi_work_dir_keys("/tmp/My_Proj!");
        let primary = kimi_work_dir_key("/tmp/My_Proj!");
        assert!(keys.contains(&primary), "{keys:?}");
        let set: HashSet<_> = keys.iter().cloned().collect();
        assert_eq!(set.len(), keys.len());
    }

    #[test]
    fn data_root_prefers_env_over_home() {
        let tmp = std::env::temp_dir().join(format!("sema-kimi-home-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        // Safety: only set for this test process; restore after
        let prev = std::env::var_os("KIMI_CODE_HOME");
        std::env::set_var("KIMI_CODE_HOME", &tmp);
        let root = kimi_data_root(Some(Path::new("/unused/home")));
        assert_eq!(root, tmp);
        match prev {
            Some(v) => std::env::set_var("KIMI_CODE_HOME", v),
            None => std::env::remove_var("KIMI_CODE_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn index_applies_tombstone_and_last_write_wins() {
        let tmp = std::env::temp_dir().join(format!("sema-kimi-idx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let index = tmp.join("session_index.jsonl");
        fs::write(
            &index,
            r#"{"sessionId":"a","sessionDir":"/x/a","workDir":"/proj"}
{"sessionId":"a","sessionDir":"/x/a2","workDir":"/proj"}
{"sessionId":"a","deleted":true}
{"sessionId":"b","sessionDir":"/x/b","workDir":"/proj"}
"#,
        )
        .unwrap();
        let entries = read_session_index(&tmp);
        assert!(!entries.iter().any(|(id, _, _)| id == "a"));
        assert!(entries.iter().any(|(id, _, _)| id == "b"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn index_last_write_wins_session_dir() {
        let tmp = std::env::temp_dir().join(format!("sema-kimi-lww-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let index = tmp.join("session_index.jsonl");
        fs::write(
            &index,
            r#"{"sessionId":"a","sessionDir":"/x/a","workDir":"/p1"}
{"sessionId":"a","sessionDir":"/x/a2","workDir":"/p2"}
"#,
        )
        .unwrap();
        let entries = read_session_index(&tmp);
        assert_eq!(entries, vec![("a".into(), "/x/a2".into(), "/p2".into())]);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resume_args_prefer_session_then_continue() {
        assert_eq!(kimi_no_id_fallback(), vec!["--continue".to_string()]);
        let tmp = std::env::temp_dir().join(format!("sema-kimi-res-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        // empty user home → no ~/.kimi-code/sessions
        assert!(kimi_resume_args("/no/such/proj", Some(&tmp)).is_empty());
        // with one session on disk via workDirKey scan
        let cwd = "/tmp/kimi-proj-resume";
        let key = kimi_work_dir_key(cwd);
        let sid = "sess-resume-1";
        let sess = tmp.join(".kimi-code").join("sessions").join(&key).join(sid);
        fs::create_dir_all(&sess).unwrap();
        fs::write(
            sess.join("state.json"),
            r#"{"workDir":"/tmp/kimi-proj-resume"}"#,
        )
        .unwrap();
        let args = kimi_resume_args(cwd, Some(&tmp));
        assert_eq!(args, vec!["--session".to_string(), sid.to_string()]);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn list_filters_other_cwd_and_respects_index() {
        let tmp = std::env::temp_dir().join(format!("sema-kimi-list-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let cwd = "/tmp/kimi-list-a";
        let other = "/tmp/kimi-list-b";
        let key_a = kimi_work_dir_key(cwd);
        let key_b = kimi_work_dir_key(other);
        for (key, id) in [(&key_a, "a1"), (&key_b, "b1")] {
            let d = tmp.join(".kimi-code").join("sessions").join(key).join(id);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("state.json"), "{}").unwrap();
        }
        let list = list_kimi_session_ids(cwd, Some(&tmp));
        assert!(list.iter().any(|e| e.id == "a1"));
        assert!(!list.iter().any(|e| e.id == "b1"));
        let _ = fs::remove_dir_all(&tmp);
    }
}
