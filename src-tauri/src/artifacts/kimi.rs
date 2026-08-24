//! Kimi Code session artifacts from `agents/main/wire.jsonl`.

use std::path::Path;

use super::extract::{collect_from_texts, texts_from_jsonl};
use super::types::ArtifactsResult;
use crate::resume::find_kimi_session_dir;

pub fn artifacts_for_kimi(cwd: &str, session_id: &str, home: Option<&Path>) -> ArtifactsResult {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return ArtifactsResult::default();
    }
    let Some(dir) = find_kimi_session_dir(cwd, session_id, home) else {
        return ArtifactsResult::default();
    };
    let wire = dir.join("agents").join("main").join("wire.jsonl");
    if !wire.is_file() {
        return ArtifactsResult::default();
    }
    collect_from_texts(&texts_from_jsonl(&wire), cwd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn kimi_two_sessions_do_not_mix() {
        let tmp = std::env::temp_dir().join(format!("sema-art-kimi-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let cwd = "/tmp/kimi-art";
        let key = crate::resume::kimi_work_dir_key(cwd);
        for (id, url) in [
            ("sess-a", "https://only-a.example/x"),
            ("sess-b", "https://only-b.example/y"),
        ] {
            let wire = tmp
                .join(".kimi-code")
                .join("sessions")
                .join(&key)
                .join(id)
                .join("agents")
                .join("main");
            fs::create_dir_all(&wire).unwrap();
            fs::write(
                tmp.join(".kimi-code")
                    .join("sessions")
                    .join(&key)
                    .join(id)
                    .join("state.json"),
                "{}",
            )
            .unwrap();
            fs::write(
                wire.join("wire.jsonl"),
                format!(r#"{{"type":"turn.response","text":"{url} docs/{id}.md"}}"#),
            )
            .unwrap();
        }
        let a = artifacts_for_kimi(cwd, "  sess-a  ", Some(&tmp));
        let missing = artifacts_for_kimi(cwd, "missing", Some(&tmp));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("only-a")));
        assert!(!a.links.iter().any(|l| l.url.contains("only-b")));
        assert!(missing.docs.is_empty() && missing.links.is_empty());
    }

    #[test]
    fn kimi_artifacts_from_index_session_dir() {
        let tmp = std::env::temp_dir().join(format!("sema-art-kimi-idx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let cwd = "/tmp/kimi-art-idx";
        let sid = "idx-sess";
        let root = tmp.join(".kimi-code");
        let custom = root.join("custom").join(sid);
        let wire = custom.join("agents").join("main");
        fs::create_dir_all(&wire).unwrap();
        fs::write(
            custom.join("state.json"),
            r#"{"workDir":"/tmp/kimi-art-idx"}"#,
        )
        .unwrap();
        fs::write(
            wire.join("wire.jsonl"),
            r#"{"type":"turn.response","text":"https://from-index.example/z"}"#,
        )
        .unwrap();
        fs::write(
            root.join("session_index.jsonl"),
            format!(r#"{{"sessionId":"{sid}","sessionDir":"custom/{sid}","workDir":"{cwd}"}}"#),
        )
        .unwrap();
        let a = artifacts_for_kimi(cwd, sid, Some(&tmp));
        let wrong_cwd = artifacts_for_kimi("/tmp/other-proj", sid, Some(&tmp));
        let _ = fs::remove_dir_all(&tmp);
        assert!(a.links.iter().any(|l| l.url.contains("from-index")));
        assert!(wrong_cwd.docs.is_empty() && wrong_cwd.links.is_empty());
    }

    #[test]
    fn extract_artifacts_dispatches_kimi() {
        let tmp = std::env::temp_dir().join(format!("sema-art-kimi-disp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let cwd = "/tmp/kimi-art-disp";
        let key = crate::resume::kimi_work_dir_key(cwd);
        let sid = "sess-disp";
        let wire = tmp
            .join(".kimi-code")
            .join("sessions")
            .join(&key)
            .join(sid)
            .join("agents")
            .join("main");
        fs::create_dir_all(&wire).unwrap();
        fs::write(
            tmp.join(".kimi-code")
                .join("sessions")
                .join(&key)
                .join(sid)
                .join("state.json"),
            "{}",
        )
        .unwrap();
        fs::write(
            wire.join("wire.jsonl"),
            r#"{"type":"turn.response","text":"https://kimi-dispatch.example/x"}"#,
        )
        .unwrap();
        let r = super::super::extract_artifacts("kimi", cwd, sid, Some(&tmp));
        let _ = fs::remove_dir_all(&tmp);
        assert!(r.links.iter().any(|l| l.url.contains("kimi-dispatch")));
    }
}
