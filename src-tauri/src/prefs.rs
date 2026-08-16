//! Prefs JSON compatible with Electron SeMa.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub last: Option<Value>,
    #[serde(default)]
    pub cli_counts: HashMap<String, u64>,
    #[serde(default)]
    pub split: Option<Value>,
    #[serde(default)]
    pub layout: Option<Value>,
}

fn default_sidebar_width() -> u32 {
    160
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            sidebar_width: 160,
            sidebar_collapsed: false,
            last: None,
            cli_counts: HashMap::new(),
            split: None,
            layout: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsWithHome {
    #[serde(flatten)]
    pub prefs: Prefs,
    pub home_dir: String,
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("prefs.json"))
}

fn cli_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("cli-cache.json"))
}

/// Prefer Tauri app data; if missing, migrate once from legacy Electron `sema/` dir.
fn legacy_electron_prefs_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    #[cfg(target_os = "macos")]
    {
        // Electron used ~/Library/Application Support/sema/
        return Some(base.join("sema").join("prefs.json"));
    }
    #[cfg(windows)]
    {
        return Some(base.join("sema").join("prefs.json"));
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        Some(base.join("sema").join("prefs.json"))
    }
}

pub fn load_prefs(app: &AppHandle) -> Prefs {
    let Ok(path) = prefs_path(app) else {
        return Prefs::default();
    };
    if let Ok(s) = fs::read_to_string(&path) {
        return serde_json::from_str(&s).unwrap_or_default();
    }
    if let Some(legacy) = legacy_electron_prefs_path() {
        if let Ok(s) = fs::read_to_string(&legacy) {
            if let Ok(prefs) = serde_json::from_str::<Prefs>(&s) {
                let _ = save_prefs(app, &prefs);
                return prefs;
            }
        }
    }
    Prefs::default()
}

pub fn save_prefs(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let s = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())
}

pub fn write_cli_cache(app: &AppHandle, tools: &[crate::cli_detect::ToolInfo]) -> Result<(), String> {
    let path = cli_cache_path(app)?;
    let body = serde_json::json!({
        "detectedAt": chrono_like_now(),
        "tools": tools,
    });
    fs::write(path, serde_json::to_string_pretty(&body).unwrap()).map_err(|e| e.to_string())
}

fn chrono_like_now() -> String {
    // Avoid chrono dep — ISO-ish local not required; use unix secs stamp.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

pub fn merge_prefs(mut prefs: Prefs, partial: &Value) -> Prefs {
    if let Some(v) = partial.get("sidebarWidth") {
        if let Some(n) = v.as_u64() {
            prefs.sidebar_width = n as u32;
        }
    }
    if let Some(v) = partial.get("sidebarCollapsed") {
        if let Some(b) = v.as_bool() {
            prefs.sidebar_collapsed = b;
        }
    }
    if partial.get("last").is_some() {
        prefs.last = partial.get("last").cloned();
    }
    if partial.get("split").is_some() {
        prefs.split = partial.get("split").cloned();
    }
    if partial.get("layout").is_some() {
        prefs.layout = partial.get("layout").cloned();
    }
    if let Some(counts) = partial.get("cliCounts").and_then(|v| v.as_object()) {
        for (k, v) in counts {
            if let Some(n) = v.as_u64() {
                prefs.cli_counts.insert(k.clone(), n);
            }
        }
    }
    prefs
}
