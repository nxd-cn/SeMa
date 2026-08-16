//! Shared types for resume detection (mirrors resume-detect.js shapes).

use serde::{Deserialize, Serialize};

/// On-disk session id with mtime (newest-first lists use `mtime_ms`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEntry {
    pub id: String,
    /// Milliseconds since UNIX epoch (JS `mtimeMs`).
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

/// Options for `resolve_resume_selection` (↻ / respawn).
#[derive(Debug, Clone, Default)]
pub struct ResumeOpts {
    pub resume: bool,
    pub cli_session_id: Option<String>,
    pub exclude_ids: Vec<String>,
    pub claimed_ids: Vec<String>,
}

/// Result of choosing resume argv for a pane.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResumeSelection {
    pub args: Vec<String>,
    #[serde(rename = "resolvedId")]
    pub resolved_id: Option<String>,
    #[serde(rename = "usedBound")]
    pub used_bound: bool,
}
