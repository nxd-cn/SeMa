//! http(s) URLs SeMa can pass to pane webview / system browser.

use tauri::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenableUrlError {
    Empty,
    InvalidChars,
    Parse,
    Scheme,
    Host,
}

impl OpenableUrlError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "empty url",
            Self::InvalidChars => "url has invalid characters",
            Self::Parse => "invalid url",
            Self::Scheme => "only http(s) urls are supported",
            Self::Host => "url missing host",
        }
    }
}

pub fn is_openable_http_url(raw: &str) -> bool {
    parse_openable_http_url(raw).is_ok()
}

/// Stricter than transcript regex: must parse as http(s) with a non-empty host.
pub fn parse_openable_http_url(raw: &str) -> Result<Url, OpenableUrlError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(OpenableUrlError::Empty);
    }
    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c == '<' || c == '>')
    {
        return Err(OpenableUrlError::InvalidChars);
    }
    let parsed = trimmed
        .parse::<Url>()
        .map_err(|_| OpenableUrlError::Parse)?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(OpenableUrlError::Scheme),
    }
    match parsed.host_str() {
        Some(host) if !host.is_empty() => {}
        _ => return Err(OpenableUrlError::Host),
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_typical_https() {
        assert!(is_openable_http_url("https://example.com/a"));
        assert!(is_openable_http_url("http://127.0.0.1:8080/x"));
        assert!(is_openable_http_url("https://localhost/docs"));
    }

    #[test]
    fn rejects_unopenable_schemes_and_garbage() {
        assert!(!is_openable_http_url(""));
        assert!(!is_openable_http_url("https://"));
        assert!(!is_openable_http_url("file:///tmp/x"));
        assert!(!is_openable_http_url("javascript:alert(1)"));
        assert!(!is_openable_http_url("https://example.com/a b"));
        assert!(!is_openable_http_url("https://example.com:999999/"));
        assert!(!is_openable_http_url("http://"));
    }
}
