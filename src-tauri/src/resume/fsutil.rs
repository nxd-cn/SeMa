//! Small filesystem helpers shared across CLI detectors.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::types::SessionEntry;

pub fn mtime_ms(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

pub fn dir_has_session_files(dir: &Path) -> bool {
    if dir.as_os_str().is_empty() || !dir.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for e in entries.flatten() {
        if e.file_name().to_string_lossy().ends_with(".jsonl") {
            return true;
        }
    }
    let nested = dir.join("sessions");
    if !nested.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(&nested) else {
        return false;
    };
    entries
        .flatten()
        .any(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
}

#[allow(dead_code)]
pub fn dir_has_json_files(dir: &Path) -> bool {
    if dir.as_os_str().is_empty() || !dir.exists() {
        return false;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|e| e.file_name().to_string_lossy().ends_with(".json"))
}

pub fn file_mentions_cwd(file_path: &Path, variants: &[String]) -> bool {
    let Ok(raw) = fs::read(file_path) else {
        return false;
    };
    let end = raw.len().min(8000);
    let text = String::from_utf8_lossy(&raw[..end]);
    variants.iter().any(|v| text.contains(v))
}

pub fn sort_newest_first(entries: &mut [SessionEntry]) {
    entries.sort_by(|a, b| {
        b.mtime_ms
            .partial_cmp(&a.mtime_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}
