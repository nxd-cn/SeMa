//! Dock / taskbar unread badge.

use tauri::{AppHandle, Runtime};

#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use tauri::image::Image;
#[cfg(windows)]
use tauri::Manager;

const OVERLAY_SIZE: usize = 32;

/// 3×5 digit bitmaps, MSB left; rows top→bottom.
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b001, 0b001, 0b001], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

pub fn clamp_badge_count(n: i64) -> i32 {
    if n <= 0 {
        return 0;
    }
    (n.min(99)) as i32
}

pub fn badge_description(n: i32) -> String {
    if n <= 0 {
        String::new()
    } else {
        format!("{n} 个未读")
    }
}

/// Build 32×32 RGBA for Windows taskbar overlay. Empty when count clamps to 0.
pub fn overlay_rgba_for_count(n: i64) -> Vec<u8> {
    let c = clamp_badge_count(n);
    if c == 0 {
        return Vec::new();
    }
    build_rgba(c as u32)
}

fn draw_digit(rgba: &mut [u8], digit: u32, ox: i32, oy: i32, scale: i32, color: [u8; 4]) {
    let Some(rows) = DIGITS.get(digit as usize) else {
        return;
    };
    for y in 0..5 {
        for x in 0..3 {
            if (rows[y] >> (2 - x)) & 1 == 0 {
                continue;
            }
            for dy in 0..scale {
                for dx in 0..scale {
                    let px = ox + x as i32 * scale + dx;
                    let py = oy + y as i32 * scale + dy;
                    if px < 0 || py < 0 || px >= OVERLAY_SIZE as i32 || py >= OVERLAY_SIZE as i32 {
                        continue;
                    }
                    let i = (py as usize * OVERLAY_SIZE + px as usize) * 4;
                    rgba[i..i + 4].copy_from_slice(&color);
                }
            }
        }
    }
}

fn build_rgba(count: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; OVERLAY_SIZE * OVERLAY_SIZE * 4];
    let cx = (OVERLAY_SIZE - 1) as f32 / 2.0;
    let cy = (OVERLAY_SIZE - 1) as f32 / 2.0;
    let r = 15.0_f32;
    for y in 0..OVERLAY_SIZE {
        for x in 0..OVERLAY_SIZE {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            if dx * dx + dy * dy <= r * r {
                let i = (y * OVERLAY_SIZE + x) * 4;
                rgba[i] = 0xe0;
                rgba[i + 1] = 0x3e;
                rgba[i + 2] = 0x3e;
                rgba[i + 3] = 255;
            }
        }
    }
    let text = count.to_string();
    let scale = if count >= 10 { 2 } else { 3 };
    let glyph_w = 3 * scale;
    let glyph_h = 5 * scale;
    let gap = scale;
    let total_w = text.len() as i32 * glyph_w + (text.len() as i32 - 1) * gap;
    let mut ox = ((OVERLAY_SIZE as i32 - total_w) / 2).max(0);
    let oy = ((OVERLAY_SIZE as i32 - glyph_h) / 2).max(0);
    for ch in text.chars() {
        let d = ch.to_digit(10).unwrap_or(0);
        draw_digit(&mut rgba, d, ox, oy, scale, [255, 255, 255, 255]);
        ox += glyph_w + gap;
    }
    rgba
}

#[cfg(windows)]
static OVERLAY_CACHE: Mutex<Option<(i32, Vec<u8>)>> = Mutex::new(None);

#[cfg(windows)]
fn cached_overlay_rgba(n: i32) -> Vec<u8> {
    let mut cache = OVERLAY_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((cached_n, bytes)) = cache.as_ref() {
        if *cached_n == n {
            return bytes.clone();
        }
    }
    let bytes = overlay_rgba_for_count(n as i64);
    *cache = Some((n, bytes.clone()));
    bytes
}

pub fn apply_badge<R: Runtime>(app: &AppHandle<R>, count: i64) {
    let n = clamp_badge_count(count);
    #[cfg(target_os = "macos")]
    {
        set_macos_badge(n);
        let _ = app;
    }
    #[cfg(windows)]
    {
        // Windows taskbar overlay (Electron setOverlayIcon). Not set_badge_count / flashFrame.
        if let Some(win) = app.get_webview_window("main") {
            if n <= 0 {
                let _ = win.set_overlay_icon(None);
                if let Ok(mut cache) = OVERLAY_CACHE.lock() {
                    *cache = None;
                }
            } else {
                let rgba = cached_overlay_rgba(n);
                let icon = Image::new_owned(rgba, OVERLAY_SIZE as u32, OVERLAY_SIZE as u32);
                let _ = win.set_overlay_icon(Some(icon));
            }
        }
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        let _ = (app, n);
    }
}

#[cfg(target_os = "macos")]
fn set_macos_badge(n: i32) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;

    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => return,
    };
    let app = NSApplication::sharedApplication(mtm);
    let tile = app.dockTile();
    if n <= 0 {
        tile.setBadgeLabel(None);
    } else {
        let label = NSString::from_str(&n.to_string());
        tile.setBadgeLabel(Some(&label));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp() {
        assert_eq!(clamp_badge_count(0), 0);
        assert_eq!(clamp_badge_count(-1), 0);
        assert_eq!(clamp_badge_count(5), 5);
        assert_eq!(clamp_badge_count(200), 99);
    }

    #[test]
    fn description() {
        assert_eq!(badge_description(0), "");
        assert_eq!(badge_description(2), "2 个未读");
        assert_eq!(badge_description(99), "99 个未读");
    }

    #[test]
    fn overlay_rgba_empty_when_zero() {
        assert!(overlay_rgba_for_count(0).is_empty());
        assert!(overlay_rgba_for_count(-3).is_empty());
    }

    #[test]
    fn overlay_rgba_size_and_clamps() {
        let one = overlay_rgba_for_count(1);
        assert_eq!(one.len(), 32 * 32 * 4);
        // Circle edge (top): red, outside digit glyph.
        let i = (2 * 32 + 16) * 4;
        assert_eq!(&one[i..i + 4], &[0xe0, 0x3e, 0x3e, 255]);
        // Corner outside circle stays transparent.
        assert_eq!(&one[0..4], &[0, 0, 0, 0]);

        let a = overlay_rgba_for_count(150);
        let b = overlay_rgba_for_count(99);
        assert_eq!(a, b);
        assert_eq!(a.len(), 32 * 32 * 4);
    }
}
