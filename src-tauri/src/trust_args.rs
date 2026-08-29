//! Startup argv that skip workspace-trust prompts.

use std::collections::HashMap;
use std::sync::LazyLock;

static TRUST_ARGS: LazyLock<HashMap<&'static str, Vec<&'static str>>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert("cursor", vec!["--trust"]);
    m.insert("gemini", vec!["--skip-trust"]);
    // Kimi Code: YOLO — auto-approve tool calls (Win + Mac). Mutually exclusive with --auto.
    m.insert("kimi", vec!["--yolo"]);
    m
});

pub fn trust_args_for(cli_id: &str) -> Vec<String> {
    TRUST_ARGS
        .get(cli_id)
        .map(|v| v.iter().map(|s| (*s).to_string()).collect())
        .unwrap_or_default()
}

pub fn launch_args_for(cli_id: &str, resume_args: &[String]) -> Vec<String> {
    let mut out = trust_args_for(cli_id);
    out.extend(resume_args.iter().cloned().filter(|s| !s.is_empty()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_cursor_gemini_kimi() {
        assert_eq!(trust_args_for("cursor"), vec!["--trust".to_string()]);
        assert_eq!(trust_args_for("gemini"), vec!["--skip-trust".to_string()]);
        assert_eq!(trust_args_for("kimi"), vec!["--yolo".to_string()]);
        assert!(trust_args_for("claude").is_empty());
    }

    #[test]
    fn launch_trust_then_resume() {
        let args = launch_args_for("cursor", &["--continue".into()]);
        assert_eq!(args, vec!["--trust".to_string(), "--continue".to_string()]);
    }
}
