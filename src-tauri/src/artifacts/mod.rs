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
    since_seq: Option<u64>,
) -> ArtifactsResult {
    if cli_session_id.trim().is_empty() {
        return ArtifactsResult::default();
    }

    match cli_id {
        "claude" => claude::artifacts_for_claude(cwd, cli_session_id, home, since_seq),
        "codex" => codex::artifacts_for_codex(cwd, cli_session_id, home, since_seq),
        "gemini" => gemini::artifacts_for_gemini(cwd, cli_session_id, home, since_seq),
        "pi" => pi::artifacts_for_pi(cwd, cli_session_id, home, since_seq),
        "cursor" => cursor::artifacts_for_cursor(cwd, cli_session_id, home, since_seq),
        "opencode" => opencode::artifacts_for_opencode(cwd, cli_session_id, home, since_seq),
        "kimi" => kimi::artifacts_for_kimi(cwd, cli_session_id, home, since_seq),
        _ => ArtifactsResult::default(),
    }
}

/// Max sequence index currently stored for the session (0 when empty / missing).
pub fn session_seq_cursor(
    cli_id: &str,
    cwd: &str,
    cli_session_id: &str,
    home: Option<&Path>,
) -> u64 {
    if cli_session_id.trim().is_empty() {
        return 0;
    }
    session_texts(cli_id, cwd, cli_session_id, home)
        .iter()
        .map(|(seq, _)| *seq)
        .max()
        .unwrap_or(0)
}

pub(crate) fn session_texts(
    cli_id: &str,
    cwd: &str,
    cli_session_id: &str,
    home: Option<&Path>,
) -> Vec<(u64, String)> {
    match cli_id {
        "claude" => claude::session_texts_for_claude(cwd, cli_session_id, home),
        "codex" => codex::session_texts_for_codex(cli_session_id, home),
        "gemini" => gemini::session_texts_for_gemini(cwd, cli_session_id, home),
        "pi" => pi::session_texts_for_pi(cwd, cli_session_id, home),
        "cursor" => cursor::session_texts_for_cursor(cwd, cli_session_id, home),
        "opencode" => opencode::session_texts_for_opencode(cli_session_id, home),
        "kimi" => kimi::session_texts_for_kimi(cwd, cli_session_id, home),
        _ => Vec::new(),
    }
}

pub(crate) fn filter_texts_since(
    texts: Vec<(u64, String)>,
    since_seq: Option<u64>,
) -> Vec<(u64, String)> {
    match since_seq {
        None => texts,
        Some(s) => texts.into_iter().filter(|(seq, _)| *seq > s).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_session_id_returns_empty() {
        let r = extract_artifacts("claude", "/tmp", "", None, None);
        assert!(r.docs.is_empty() && r.links.is_empty());
    }

    #[test]
    fn filter_texts_since_excludes_at_and_before_cursor() {
        let texts = vec![
            (1, "https://old.example/a".into()),
            (2, "https://new.example/b".into()),
        ];
        let all = filter_texts_since(texts.clone(), None);
        assert_eq!(all.len(), 2);
        let after = filter_texts_since(texts, Some(1));
        assert_eq!(after.len(), 1);
        assert!(after[0].1.contains("new.example"));
    }
}
