pub mod claude;
pub mod codex;
pub mod cursor;
pub mod extract;
pub mod gemini;
pub mod kimi;
pub mod opencode;
pub mod pi;
pub mod types;

pub use extract::{collect_from_texts, is_doc_path, normalize_path_key};
pub use types::{ArtifactsResult, DocArtifact, LinkArtifact};

use std::path::Path;

/// Collect docs/links for a CLI session. Unwired CLI readers return empty.
pub fn extract_artifacts(
    cli_id: &str,
    cwd: &str,
    cli_session_id: &str,
    home: Option<&Path>,
) -> ArtifactsResult {
    if cli_session_id.trim().is_empty() {
        return ArtifactsResult::default();
    }

    match cli_id {
        "claude" => claude::artifacts_for_claude(cwd, cli_session_id, home),
        "codex" => codex::artifacts_for_codex(cwd, cli_session_id, home),
        "gemini" => gemini::artifacts_for_gemini(cwd, cli_session_id, home),
        "pi" => pi::artifacts_for_pi(cwd, cli_session_id, home),
        "cursor" => cursor::artifacts_for_cursor(cwd, cli_session_id, home),
        "opencode" => opencode::artifacts_for_opencode(cwd, cli_session_id, home),
        "kimi" => kimi::artifacts_for_kimi(cwd, cli_session_id, home),
        _ => ArtifactsResult::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_session_id_returns_empty() {
        let r = extract_artifacts("claude", "/tmp", "", None);
        assert!(r.docs.is_empty() && r.links.is_empty());
    }

    #[test]
    fn unknown_cli_returns_empty() {
        let r = extract_artifacts("unknown-cli", "/tmp", "some-id", None);
        assert!(r.docs.is_empty() && r.links.is_empty());
    }
}
