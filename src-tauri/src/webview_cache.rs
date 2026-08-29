//! Bust WebView HTTP/disk cache when the app version changes.
//!
//! Packaged SeMa loads the UI over Tauri's custom protocol. Win WebView2 /
//! Mac WKWebView can keep a stale `index.html` + hashed assets after an
//! updater install; the page has no context-menu refresh. Track the last
//! cleared package version under app data and clear + reload once per bump.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};

fn marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("webview-asset-version.txt"))
}

fn read_marker(app: &AppHandle) -> String {
    marker_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn write_marker(app: &AppHandle, version: &str) {
    if let Ok(path) = marker_path(app) {
        let _ = fs::write(path, version);
    }
}

/// If `package_info().version` differs from the last bust, clear browsing data
/// and reload so the new frontend bundle is fetched. No-op in debug / when
/// unchanged. Safe on Win + Mac (prefs live in app data, not WebView storage).
pub fn bust_if_version_changed(app: &AppHandle, win: &WebviewWindow) {
    if cfg!(debug_assertions) {
        return;
    }
    let version = app.package_info().version.to_string();
    if read_marker(app) == version {
        return;
    }
    // Persist first so a failed reload cannot loop forever.
    write_marker(app, &version);
    let _ = win.clear_all_browsing_data();
    let _ = win.reload();
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_compare_trims() {
        let prev = " 1.0.9\n";
        assert_eq!(prev.trim(), "1.0.9");
        assert_ne!(prev.trim(), "1.0.10");
    }
}
