/** Attach image paths for AI CLI prompts (`@path`). Terminal gets a bare path. */

const IMAGE_EXT = /\.(png|jpe?g|jfif|gif|webp|bmp|tiff?|heic|ico)$/i;

export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.test(String(name || ""));
}

export function isImageMime(mime: string): boolean {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("image/") && !m.includes("svg");
}

/** Quote path for CLI attach: `@/a/b.png` or `@"C:\a b.png"`. */
export function formatImageAttach(path: string, cliId?: string): string {
  const p = String(path || "").trim();
  if (!p) return "";
  if (cliId === "terminal") {
    return /\s/.test(p) ? `"${p.replace(/"/g, '\\"')}" ` : `${p} `;
  }
  if (/[\s"]/.test(p)) {
    return `@"${p.replace(/"/g, '\\"')}" `;
  }
  return `@${p} `;
}

/** Absolute path on File when WebView exposes it (Tauri HTML5 drop). */
export function fileSystemPath(file: File): string | null {
  const anyFile = file as File & { path?: string };
  const p = typeof anyFile.path === "string" ? anyFile.path.trim() : "";
  if (!p) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")) {
    return p;
  }
  return null;
}

function percentDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse clipboard text into an absolute image path (Win + Mac).
 * Handles quoted paths, `file://` / `file://localhost/` URLs.
 * Win: `file:///C:/a.png` → `C:/a.png`; Mac: `file:///Users/a.png` → `/Users/a.png`.
 */
export function parseClipboardImagePath(text: string): string | null {
  let trimmed = String(text || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("file:")) {
    let rest = trimmed.replace(/^file:\/\//i, "");
    if (rest.toLowerCase().startsWith("localhost")) {
      rest = rest.slice("localhost".length);
    } else if (!rest.startsWith("/")) {
      const slash = rest.indexOf("/");
      if (slash < 0) return null;
      rest = rest.slice(slash);
    }
    // rest is like /C:/a.png (Win) or /Users/... (Mac)
    rest = percentDecode(rest);
    if (/^\/[a-zA-Z]:/.test(rest)) {
      trimmed = rest.slice(1); // Win drive
    } else {
      trimmed = rest; // POSIX keep leading /
    }
  }

  if (!isImageFileName(trimmed)) return null;
  if (
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  ) {
    return trimmed;
  }
  return null;
}
