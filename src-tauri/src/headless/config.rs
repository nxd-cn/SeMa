//! Config-proxy: read/write CLI config files (Key/provider). Never log secrets.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::platform::home_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigView {
    pub id: String,
    pub base_url: String,
    pub has_api_key: bool,
    /// Masked preview only (never full key).
    pub api_key_hint: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigView {
    pub cli_id: String,
    pub kind: String,
    pub config_path: Option<String>,
    pub providers: Vec<ProviderConfigView>,
    pub detail: String,
    pub supports_key_form: bool,
    pub supports_login: bool,
}

pub fn config_view(cli_id: &str) -> CliConfigView {
    match cli_id {
        "opencode" => opencode_view(),
        "pi" => pi_view(),
        "claude" => oauth_only(cli_id, "oauth", true),
        "cursor" => oauth_only(cli_id, "oauth", true),
        "codex" => oauth_only(cli_id, "oauth", true),
        "gemini" => oauth_only(cli_id, "oauth", true),
        "kimi" => CliConfigView {
            cli_id: cli_id.into(),
            kind: "api_key".into(),
            config_path: None,
            providers: Vec::new(),
            detail: "Kimi 多用环境变量 / 官方登录；可打开配置目录或使用登录引导".into(),
            supports_key_form: false,
            supports_login: false,
        },
        _ => oauth_only(cli_id, "unknown", false),
    }
}

fn oauth_only(cli_id: &str, kind: &str, supports_login: bool) -> CliConfigView {
    CliConfigView {
        cli_id: cli_id.into(),
        kind: kind.into(),
        config_path: None,
        providers: Vec::new(),
        detail: if supports_login {
            "账号登录型：请用「登录」完成授权，Key 不由 SeMa 代填".into()
        } else {
            "暂无配置代理表单".into()
        },
        supports_key_form: false,
        supports_login,
    }
}

fn opencode_config_path() -> PathBuf {
    home_dir().join(".config").join("opencode").join("opencode.json")
}

fn pi_settings_path() -> PathBuf {
    home_dir().join(".pi").join("agent").join("settings.json")
}

fn opencode_view() -> CliConfigView {
    let path = opencode_config_path();
    let mut providers = Vec::new();
    let detail;
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            if let Some(obj) = v.get("provider").and_then(|p| p.as_object()) {
                for (id, p) in obj {
                    let opts = p.get("options").cloned().unwrap_or(json!({}));
                    let key = opts
                        .get("apiKey")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    let base = opts
                        .get("baseURL")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    let models = p
                        .get("models")
                        .and_then(|m| m.as_object())
                        .map(|m| m.keys().cloned().collect::<Vec<_>>())
                        .unwrap_or_default();
                    providers.push(ProviderConfigView {
                        id: id.clone(),
                        base_url: base,
                        has_api_key: !key.is_empty(),
                        api_key_hint: mask_key(key),
                        models,
                    });
                }
            }
            detail = format!("已读 {}", path.display());
        } else {
            detail = "配置文件不是合法 JSON".into();
        }
    } else {
        detail = format!("尚无配置文件（将创建 {}）", path.display());
    }
    CliConfigView {
        cli_id: "opencode".into(),
        kind: "api_key".into(),
        config_path: Some(path.to_string_lossy().to_string()),
        providers,
        detail,
        supports_key_form: true,
        supports_login: true,
    }
}

fn pi_view() -> CliConfigView {
    let path = pi_settings_path();
    let mut providers = Vec::new();
    let detail;
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let provider = v
                .get("defaultProvider")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let model = v
                .get("defaultModel")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if !provider.is_empty() || !model.is_empty() {
                providers.push(ProviderConfigView {
                    id: if provider.is_empty() {
                        "default".into()
                    } else {
                        provider
                    },
                    base_url: String::new(),
                    has_api_key: false,
                    api_key_hint: String::new(),
                    models: if model.is_empty() {
                        Vec::new()
                    } else {
                        vec![model]
                    },
                });
            }
            detail = format!(
                "Pi 默认模型在 settings；API Key 多用环境变量。{}",
                path.display()
            );
        } else {
            detail = "settings.json 不是合法 JSON".into();
        }
    } else {
        detail = format!("未找到 {}", path.display());
    }
    CliConfigView {
        cli_id: "pi".into(),
        kind: "api_key".into(),
        config_path: Some(path.to_string_lossy().to_string()),
        providers,
        detail,
        supports_key_form: true,
        supports_login: false,
    }
}

fn mask_key(key: &str) -> String {
    let t = key.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.len() <= 8 {
        return "••••".into();
    }
    format!("{}…{}", &t[..4], &t[t.len() - 4..])
}

/// Upsert OpenCode provider options (apiKey / baseURL) and optional model id list.
pub fn set_opencode_provider(
    provider_id: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model_ids: Option<&[String]>,
) -> Result<CliConfigView, String> {
    let path = opencode_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    } else {
        json!({ "$schema": "https://opencode.ai/config.json" })
    };
    let providers = root
        .as_object_mut()
        .ok_or("root not object")?
        .entry("provider")
        .or_insert_with(|| json!({}));
    let prov = providers
        .as_object_mut()
        .ok_or("provider not object")?
        .entry(provider_id.to_string())
        .or_insert_with(|| {
            json!({
                "npm": "@ai-sdk/openai-compatible",
                "options": {},
                "models": {}
            })
        });
    let opts = prov
        .as_object_mut()
        .ok_or("provider entry not object")?
        .entry("options")
        .or_insert_with(|| json!({}));
    let opts_obj = opts.as_object_mut().ok_or("options not object")?;
    if let Some(k) = api_key.map(str::trim).filter(|s| !s.is_empty()) {
        opts_obj.insert("apiKey".into(), Value::String(k.to_string()));
    }
    if let Some(u) = base_url.map(str::trim).filter(|s| !s.is_empty()) {
        opts_obj.insert("baseURL".into(), Value::String(u.to_string()));
    }
    if let Some(models) = model_ids {
        let mut map = serde_json::Map::new();
        for id in models {
            let id = id.trim();
            if id.is_empty() {
                continue;
            }
            map.insert(id.to_string(), json!({ "name": id }));
        }
        if !map.is_empty() {
            prov.as_object_mut()
                .unwrap()
                .insert("models".into(), Value::Object(map));
        }
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())?;
    Ok(opencode_view())
}

/// Set Pi default provider/model (keys stay in env).
pub fn set_pi_defaults(provider: Option<&str>, model: Option<&str>) -> Result<CliConfigView, String> {
    let path = pi_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    let obj = root.as_object_mut().ok_or("settings not object")?;
    if let Some(p) = provider.map(str::trim).filter(|s| !s.is_empty()) {
        obj.insert("defaultProvider".into(), Value::String(p.to_string()));
    }
    if let Some(m) = model.map(str::trim).filter(|s| !s.is_empty()) {
        obj.insert("defaultModel".into(), Value::String(m.to_string()));
    }
    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())?;
    Ok(pi_view())
}

pub fn open_config_dir(cli_id: &str) -> Result<String, String> {
    let dir: PathBuf = match cli_id {
        "opencode" => home_dir().join(".config").join("opencode"),
        "pi" => home_dir().join(".pi").join("agent"),
        "claude" => home_dir().join(".claude"),
        "cursor" => home_dir().join(".cursor"),
        "kimi" => home_dir().join(".kimi-code"),
        "codex" => home_dir().join(".codex"),
        "gemini" => home_dir().join(".gemini"),
        _ => return Err("未知 CLI".into()),
    };
    if !dir.is_dir() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_key_shape() {
        assert_eq!(mask_key(""), "");
        assert_eq!(mask_key("short"), "••••");
        let m = mask_key("sk-abcdefghijklmnop");
        assert!(m.starts_with("sk-a"));
        assert!(m.contains('…'));
    }

    #[test]
    fn path_helpers_nonempty() {
        assert!(opencode_config_path().is_absolute() || opencode_config_path().components().count() > 0);
        let _ = Path::new("x");
    }
}
