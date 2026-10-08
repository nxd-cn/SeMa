//! List available models via each CLI's own command (no SDK).

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::cli_detect::ToolInfo;
use crate::headless::auth::run_capture;
use crate::platform::home_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsResult {
    pub cli_id: String,
    pub models: Vec<ModelInfo>,
    pub detail: String,
}

pub fn list_models(cli_id: &str, tool: &ToolInfo) -> ModelsResult {
    // Claude Code has no `--list-models` (unknown option). Build from settings + aliases.
    if cli_id == "claude" {
        let models = claude_models_list(None);
        return ModelsResult {
            cli_id: cli_id.into(),
            detail: if models.is_empty() {
                "未找到 Claude 模型（可手动填写 model id）".into()
            } else {
                format!("{} 个模型（settings + 别名）", models.len())
            },
            models,
        };
    }

    let argv = match cli_id {
        "cursor" => vec!["models".into()],
        "opencode" => vec!["models".into()],
        "pi" => vec!["--list-models".into()],
        "gemini" => vec!["--help".into()], // fallback parse often empty
        "codex" => vec!["--help".into()],
        "kimi" => vec!["--help".into()],
        _ => {
            return ModelsResult {
                cli_id: cli_id.into(),
                models: Vec::new(),
                detail: "该引擎无已知列模型命令".into(),
            };
        }
    };

    match run_capture(tool, &argv, None) {
        Ok((_code, stdout, stderr)) => {
            let text = if !stdout.trim().is_empty() {
                stdout
            } else {
                stderr
            };
            let models = parse_models(cli_id, &text);
            ModelsResult {
                cli_id: cli_id.into(),
                detail: if models.is_empty() {
                    "未能解析模型列表（可手动填写模型 id）".into()
                } else {
                    format!("{} 个模型", models.len())
                },
                models,
            }
        }
        Err(e) => ModelsResult {
            cli_id: cli_id.into(),
            models: Vec::new(),
            detail: e,
        },
    }
}

/// Claude Code model picker: settings env mappings + common `--model` aliases.
/// (`claude --list-models` does not exist on current CLI.)
fn claude_models_list(home: Option<&Path>) -> Vec<ModelInfo> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |id: &str, label: &str| {
        let id = id.trim();
        if id.is_empty() || !seen.insert(id.to_string()) {
            return;
        }
        out.push(ModelInfo {
            id: id.to_string(),
            label: label.trim().to_string(),
        });
    };

    // Prefer configured / gateway-mapped ids from ~/.claude/settings.json.
    let settings_path = home.join(".claude").join("settings.json");
    if let Ok(raw) = fs::read_to_string(&settings_path) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            collect_claude_settings_models(&v, &mut push);
        }
    }

    // Built-in aliases from `claude --help` (--model).
    for (id, label) in [
        ("sonnet", "sonnet (alias)"),
        ("opus", "opus (alias)"),
        ("haiku", "haiku (alias)"),
        ("fable", "fable (alias)"),
    ] {
        push(id, label);
    }

    out
}

fn collect_claude_settings_models(v: &Value, push: &mut dyn FnMut(&str, &str)) {
    // env: ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_*_MODEL(_NAME)
    if let Some(env) = v.get("env").and_then(|x| x.as_object()) {
        let mut pairs: Vec<(String, String)> = Vec::new();
        for (k, val) in env {
            let Some(s) = val.as_str() else { continue };
            let s = s.trim();
            if s.is_empty() {
                continue;
            }
            let ku = k.to_ascii_uppercase();
            if ku == "ANTHROPIC_MODEL" {
                pairs.push((s.to_string(), format!("{s} (default)")));
            } else if ku.starts_with("ANTHROPIC_DEFAULT_") && ku.ends_with("_MODEL") {
                let alias = ku
                    .trim_start_matches("ANTHROPIC_DEFAULT_")
                    .trim_end_matches("_MODEL")
                    .to_ascii_lowercase();
                pairs.push((s.to_string(), format!("{s} ({alias})")));
            } else if ku.starts_with("ANTHROPIC_DEFAULT_") && ku.ends_with("_MODEL_NAME") {
                pairs.push((s.to_string(), s.to_string()));
            }
        }
        // Stable-ish order: default first, then the rest.
        pairs.sort_by(|a, b| a.1.cmp(&b.1));
        for (id, label) in pairs {
            push(&id, &label);
        }
    }

    // Optional picker / overrides blobs if present in newer settings schemas.
    for key in ["modelPicker", "availableModels", "models"] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            for item in arr {
                if let Some(id) = item.as_str() {
                    push(id, id);
                } else if let Some(obj) = item.as_object() {
                    let id = obj
                        .get("id")
                        .or_else(|| obj.get("model"))
                        .or_else(|| obj.get("value"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    let label = obj
                        .get("label")
                        .or_else(|| obj.get("name"))
                        .and_then(|x| x.as_str())
                        .unwrap_or(id);
                    push(id, label);
                }
            }
        }
    }
    if let Some(map) = v.get("modelOverrides").and_then(|x| x.as_object()) {
        for (alias, target) in map {
            if let Some(id) = target.as_str() {
                push(id, &format!("{id} ({alias})"));
                push(alias, &format!("{alias} → {id}"));
            }
        }
    }
}

fn parse_models(cli_id: &str, text: &str) -> Vec<ModelInfo> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match cli_id {
            "cursor" => {
                // `id - Label` or `id - Label (notes)`
                if let Some((id, rest)) = line.split_once(" - ") {
                    let id = id.trim();
                    if id.is_empty() || id.eq_ignore_ascii_case("available models") {
                        continue;
                    }
                    out.push(ModelInfo {
                        id: id.to_string(),
                        label: rest.trim().to_string(),
                    });
                }
            }
            "opencode" => {
                // `provider/model`
                if line.contains('/') && !line.contains(' ') && line.len() < 120 {
                    out.push(ModelInfo {
                        id: line.to_string(),
                        label: line.to_string(),
                    });
                }
            }
            "pi" => {
                // table: provider  model  ...
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() >= 2 && cols[0] != "provider" {
                    let id = format!("{}/{}", cols[0], cols[1]);
                    out.push(ModelInfo {
                        id: id.clone(),
                        label: id,
                    });
                }
            }
            _ => {}
        }
        if out.len() >= 200 {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cursor_line() {
        let t = "Available models\nauto - Auto (current, default)\ngpt-5.2 - GPT-5.2\n";
        let m = parse_models("cursor", t);
        assert!(m.iter().any(|x| x.id == "auto"));
        assert!(m.iter().any(|x| x.id == "gpt-5.2"));
    }

    #[test]
    fn parse_opencode_line() {
        let m = parse_models("opencode", "opencode/gpt-5\nmallcoo/glm-5.2\n");
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn claude_models_from_settings_env() {
        let tmp = std::env::temp_dir().join(format!("sema-claude-models-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        let dir = home.join(".claude");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{
              "env": {
                "ANTHROPIC_MODEL": "deepseek-v4.1-flash-a",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4.1-flash-a",
                "ANTHROPIC_AUTH_TOKEN": "sk-secret-do-not-list"
              }
            }"#,
        )
        .unwrap();

        let m = claude_models_list(Some(&home));
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(m.iter().any(|x| x.id == "deepseek-v4.1-flash-a"));
        assert!(m.iter().any(|x| x.id == "sonnet"));
        assert!(m.iter().any(|x| x.id == "opus"));
        assert!(!m.iter().any(|x| x.id.contains("sk-")));
    }
}
