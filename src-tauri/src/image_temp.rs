//! Persist paste/drop images to a temp file so CLIs can attach via `@path`.
//!
//! Clipboard sources (Win + Mac):
//! - File list: Explorer CF_HDROP / Finder file URLs ? original absolute path
//! - Text path: "Copy as path" / Option+Cmd+C ? absolute path (quoted or file://)
//! - Bitmap: screenshot / Copy ? temp PNG under sema-images/

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use png::{BitDepth, ColorType, Encoder};

const MAX_BYTES: usize = 25 * 1024 * 1024;

fn images_dir() -> PathBuf {
    std::env::temp_dir().join("sema-images")
}

fn ensure_dir() -> Result<PathBuf, String> {
    let dir = images_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_ext(ext: &str) -> &'static str {
    let lower = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    match lower.as_str() {
        "png" => "png",
        "jpg" | "jpeg" | "jfif" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        "tif" | "tiff" => "tif",
        "heic" => "heic",
        "ico" => "ico",
        _ => "png",
    }
}

/// Write encoded image bytes (png/jpg/...) to a unique temp path.
pub fn save_image_bytes(bytes: &[u8], filename_hint: Option<&str>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty image".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("image too large".into());
    }
    let dir = ensure_dir()?;
    let ext = filename_hint
        .and_then(|n| Path::new(n).extension())
        .and_then(|e| e.to_str())
        .map(safe_ext)
        .unwrap_or("png");
    let name = format!("paste-{}.{}", uuid::Uuid::new_v4(), ext);
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Encode raw RGBA (row-major) as PNG and save.
pub fn save_rgba_png(rgba: &[u8], width: u32, height: u32) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("invalid size".into());
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| "invalid size".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "rgba length mismatch: got {}, expected {expected}",
            rgba.len()
        ));
    }
    if expected > MAX_BYTES {
        return Err("image too large".into());
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_bytes);
        let mut encoder = Encoder::new(&mut cursor, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    save_image_bytes(&png_bytes, Some("clipboard.png"))
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "png"
                    | "jpg"
                    | "jpeg"
                    | "jfif"
                    | "gif"
                    | "webp"
                    | "bmp"
                    | "tif"
                    | "tiff"
                    | "heic"
                    | "ico"
            )
        })
        .unwrap_or(false)
}

fn percent_decode_path(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = |c: u8| -> Option<u8> {
                match c {
                    b'0'..=b'9' => Some(c - b'0'),
                    b'a'..=b'f' => Some(c - b'a' + 10),
                    b'A'..=b'F' => Some(c - b'A' + 10),
                    _ => None,
                }
            };
            if let (Some(a), Some(b)) = (h(bytes[i + 1]), h(bytes[i + 2])) {
                out.push((a << 4) | b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Turn `file://` / `file://localhost/` URLs into a filesystem path.
/// Win: `file:///C:/a.png` ? `C:/a.png`; Mac: `file:///Users/a.png` ? `/Users/a.png`.
fn path_from_file_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    let path_part = if let Some(p) = rest.strip_prefix("localhost") {
        p
    } else if rest.starts_with('/') {
        rest
    } else if let Some(i) = rest.find('/') {
        // file://hostname/path ? rare for local paste
        &rest[i..]
    } else {
        return None;
    };
    let decoded = percent_decode_path(path_part);
    #[cfg(windows)]
    {
        // file:///C:/... ? /C:/... ? C:/...
        let d = decoded.strip_prefix('/').unwrap_or(decoded.as_str());
        Some(PathBuf::from(d))
    }
    #[cfg(not(windows))]
    {
        // Keep leading `/` for POSIX absolute paths.
        Some(PathBuf::from(decoded))
    }
}

fn path_from_clipboard_text(text: &str) -> Option<String> {
    let trimmed = text
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .trim();
    if trimmed.is_empty() {
        return None;
    }
    let as_path = if trimmed.starts_with("file:") {
        path_from_file_url(trimmed)?
    } else {
        PathBuf::from(trimmed)
    };
    if !is_image_path(&as_path) {
        return None;
    }
    // Absolute only (Win drive / UNC, or POSIX `/...`). Offline cloud files still OK.
    if as_path.is_absolute() {
        return Some(as_path.to_string_lossy().into_owned());
    }
    None
}

/// Prefer a real image file path from the clipboard (Explorer/Finder copy).
/// Falls back to decoding bitmap clipboard data into a temp PNG.
pub fn save_clipboard_image() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    // Desktop / Explorer / Finder: clipboard holds file paths (CF_HDROP / file URLs),
    // not pixel data ? get_image() fails for those.
    if let Ok(files) = clipboard.get().file_list() {
        for path in files {
            if is_image_path(&path) && path.is_absolute() {
                return Ok(path.to_string_lossy().into_owned());
            }
        }
    }

    // Win "Copy as path" / Mac Option+Cmd+C (path as text).
    if let Ok(text) = clipboard.get_text() {
        if let Some(path) = path_from_clipboard_text(&text) {
            return Ok(path);
        }
    }

    let image = clipboard.get_image().map_err(|e| e.to_string())?;
    save_rgba_png(
        image.bytes.as_ref(),
        image.width as u32,
        image.height as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_bytes_roundtrip() {
        let path = save_image_bytes(&[1, 2, 3, 4], Some("x.png")).unwrap();
        assert!(Path::new(&path).exists());
        assert!(path.ends_with(".png"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn save_rgba_1x1() {
        let path = save_rgba_png(&[255, 0, 0, 255], 1, 1).unwrap();
        assert!(Path::new(&path).exists());
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn rejects_empty() {
        assert!(save_image_bytes(&[], None).is_err());
    }

    #[test]
    fn is_image_path_ext() {
        assert!(is_image_path(Path::new(r"C:\Users\x\Desktop\a.PNG")));
        assert!(is_image_path(Path::new("/Users/x/Desktop/b.jpeg")));
        assert!(is_image_path(Path::new("/Users/x/Desktop/a.HEIC")));
        assert!(!is_image_path(Path::new("/tmp/b.txt")));
    }

    #[test]
    fn path_from_text_quoted() {
        #[cfg(windows)]
        {
            assert_eq!(
                path_from_clipboard_text(r#""C:\Users\x\Desktop\pic.png""#).as_deref(),
                Some(r"C:\Users\x\Desktop\pic.png")
            );
            assert_eq!(
                path_from_clipboard_text("file:///C:/Users/x/Desktop/a.jpg").as_deref(),
                Some("C:/Users/x/Desktop/a.jpg")
            );
        }
        #[cfg(not(windows))]
        {
            assert_eq!(
                path_from_clipboard_text("\"/Users/x/Desktop/pic.png\"").as_deref(),
                Some("/Users/x/Desktop/pic.png")
            );
            assert_eq!(
                path_from_clipboard_text("file:///Users/x/Desktop/a.jpg").as_deref(),
                Some("/Users/x/Desktop/a.jpg")
            );
            assert_eq!(
                path_from_clipboard_text("file://localhost/Users/x/Desktop/a%20b.png").as_deref(),
                Some("/Users/x/Desktop/a b.png")
            );
        }
        assert!(path_from_clipboard_text("pic.png").is_none());
    }

    #[test]
    fn clipboard_file_list_returns_image_path() {
        let dir = std::env::temp_dir().join("sema-clip-test-live");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("desk.png");
        fs::write(&path, [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();
        {
            let mut cb = arboard::Clipboard::new().unwrap();
            cb.set().file_list(&[path.clone()]).unwrap();
        }
        let got = save_clipboard_image().expect("save_clipboard_image");
        assert!(
            Path::new(&got)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&got))
                .ends_with("desk.png")
                || got.ends_with("desk.png")
        );
        let _ = fs::remove_file(&path);
    }
}
