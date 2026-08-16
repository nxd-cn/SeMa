//! Resume / session discovery for AI CLIs (port of `resume-detect.js`).
//!
//! Wire from the crate root with `mod resume;` (or `pub mod resume;`).

mod api;
mod args;
mod claude;
mod codex;
mod cursor;
mod fsutil;
mod gemini;
mod opencode;
mod paths;
mod pi;
mod types;

// —— primary public API (JS exports used by main.js) ——
pub use api::{
    can_resume, follow_rotated_session, list_session_ids, pick_created_since,
    pick_newest_unbound, resolve_resume_selection, resume_args_for, session_id_exists,
};
pub use args::{resume_args_for_id, resume_args_unchecked, supports_resume};
pub use types::{ResumeOpts, ResumeSelection, SessionEntry};

// —— helpers useful for tests / spawn wiring ——
pub use claude::{
    encode_claude_project_id, has_claude_session, list_claude_session_ids,
};
pub use codex::{codex_session_id_from_name, has_codex_session, list_codex_session_ids};
pub use cursor::{
    cursor_workspace_hash, cursor_workspace_hashes, has_cursor_sessions, list_cursor_session_ids,
};
pub use gemini::{gemini_project_hashes, has_gemini_session, list_gemini_session_ids};
pub use opencode::{
    has_opencode_session, latest_opencode_session_id, list_opencode_session_ids,
    opencode_no_id_fallback, opencode_resume_args,
};
pub use paths::{cwd_path_candidates, directory_match_keys, path_variants};
pub use pi::{encode_pi_session_dir, has_pi_session, list_pi_session_ids};
