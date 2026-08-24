//! Child webviews scoped to a pane (in-pane link preview).
//! Commands are `async` so Windows WebView2 does not deadlock on the UI thread.

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewBuilder, WebviewUrl,
};

use crate::state::AppState;

const MAIN_WINDOW_LABEL: &str = "main";

/// Tauri webview label: `pane-wv-{sanitizedPaneId}`.
/// Allowed charset: alphanumeric, `-`, `/` (other chars become `-`).
pub(crate) fn pane_webview_label(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '/' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("pane-wv-{sanitized}")
}

/// Only http(s) with a non-empty host. WKWebView/`NSURL` panics on `unwrap`
/// when `URLWithString` returns nil — reject bad URLs before `add_child`.
pub(crate) fn parse_external_url(url: &str) -> Result<tauri::Url, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty url".into());
    }
    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c == '<' || c == '>')
    {
        return Err("url has invalid characters".into());
    }
    let parsed = trimmed
        .parse::<tauri::Url>()
        .map_err(|e| format!("invalid url: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("only http(s) urls are supported".into());
    }
    match parsed.host_str() {
        Some(host) if !host.is_empty() => {}
        _ => return Err("url missing host".into()),
    }
    Ok(parsed)
}

const MIN_WEBVIEW_SIDE: f64 = 8.0;

fn validate_bounds(x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() {
        return Err("webview bounds must be finite".into());
    }
    if w < MIN_WEBVIEW_SIDE || h < MIN_WEBVIEW_SIDE {
        return Err(format!(
            "webview bounds too small ({w}x{h}; need ≥{MIN_WEBVIEW_SIDE})"
        ));
    }
    Ok(())
}

fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window not found".to_string())
        .map(|w| w.as_ref().window())
}

fn webview_by_label(app: &AppHandle, label: &str) -> Option<Webview> {
    app.get_webview(label)
}

fn apply_bounds(webview: &Webview, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(w, h).into(),
        })
        .map_err(|e| e.to_string())
}

fn remember_label(app: &AppHandle, id: &str, label: &str) {
    app.state::<AppState>()
        .pane_webviews
        .lock()
        .insert(id.to_string(), label.to_string());
}

fn forget_label(app: &AppHandle, id: &str) {
    app.state::<AppState>().pane_webviews.lock().remove(id);
}

fn label_for(app: &AppHandle, id: &str) -> String {
    app.state::<AppState>()
        .pane_webviews
        .lock()
        .get(id)
        .cloned()
        .unwrap_or_else(|| pane_webview_label(id))
}

fn require_webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    let label = label_for(app, id);
    webview_by_label(app, &label).ok_or_else(|| format!("pane webview not found: {id}"))
}

#[tauri::command]
pub async fn pane_webview_open(
    app: AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let parsed = parse_external_url(&url)?;
    validate_bounds(x, y, w, h)?;
    let label = pane_webview_label(&id);

    if let Some(webview) = webview_by_label(&app, &label) {
        // Prefer as_str() (canonical serialization WKWebView accepts).
        webview.navigate(parsed).map_err(|e| e.to_string())?;
        apply_bounds(&webview, x, y, w, h)?;
        webview.show().map_err(|e| e.to_string())?;
        remember_label(&app, &id, &label);
        return Ok(());
    }

    let window = main_window(&app)?;
    // `add_child` panics the app if wry unwraps a nil NSURL — validation above
    // is the guard. Soft-fail any builder error to the frontend fallback UI.
    window
        .add_child(
            WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed)),
            LogicalPosition::new(x, y),
            LogicalSize::new(w, h),
        )
        .map_err(|e| e.to_string())?;
    remember_label(&app, &id, &label);
    Ok(())
}

#[tauri::command]
pub async fn pane_webview_set_bounds(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    validate_bounds(x, y, w, h)?;
    let webview = require_webview(&app, &id)?;
    apply_bounds(&webview, x, y, w, h)
}

#[tauri::command]
pub async fn pane_webview_set_visible(
    app: AppHandle,
    id: String,
    visible: bool,
) -> Result<(), String> {
    let webview = require_webview(&app, &id)?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn pane_webview_close(app: AppHandle, id: String) -> Result<(), String> {
    let label = label_for(&app, &id);
    if let Some(webview) = webview_by_label(&app, &label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    forget_label(&app, &id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{pane_webview_label, parse_external_url, validate_bounds};

    #[test]
    fn label_keeps_uuid_pane_id() {
        assert_eq!(
            pane_webview_label("s-550e8400-e29b-41d4-a716-446655440000"),
            "pane-wv-s-550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[test]
    fn label_sanitizes_illegal_chars() {
        assert_eq!(pane_webview_label("a.b c_d:e"), "pane-wv-a-b-c-d-e");
    }

    #[test]
    fn label_keeps_slash() {
        assert_eq!(pane_webview_label("pane/1"), "pane-wv-pane/1");
    }

    #[test]
    fn parse_accepts_https_with_host() {
        assert!(parse_external_url("https://example.com/a").is_ok());
    }

    #[test]
    fn parse_rejects_empty_and_non_http() {
        assert!(parse_external_url("").is_err());
        assert!(parse_external_url("  ").is_err());
        assert!(parse_external_url("file:///tmp/x").is_err());
        assert!(parse_external_url("javascript:alert(1)").is_err());
        assert!(parse_external_url("https://").is_err());
        assert!(parse_external_url("https://example.com/a b").is_err());
    }

    #[test]
    fn bounds_reject_zero_or_nan() {
        assert!(validate_bounds(0.0, 0.0, 100.0, 100.0).is_ok());
        assert!(validate_bounds(0.0, 0.0, 0.0, 100.0).is_err());
        assert!(validate_bounds(0.0, 0.0, 100.0, f64::NAN).is_err());
    }
}
