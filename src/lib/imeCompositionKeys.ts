/**
 * Keys that must not reach xterm CompositionHelper while IME may be active.
 *
 * On macOS, CapsLock toggles Chinese IME ↔ English. xterm 5.5 treats CapsLock
 * (keyCode 20) as a non-modifier during composition and early-finalizes, then
 * compositionend sends the same text again → duplicate characters.
 * Upstream fix: xterm.js #5282 (shipped in 6.0). We swallow CapsLock in the
 * custom key handler so CompositionHelper never sees it (same effect).
 *
 * Tauri WKWebView may report CapsLock with keyCode 0 / empty or Unidentified
 * key; only `code === "CapsLock"` is reliable — check that too.
 *
 * Safe on Windows: CapsLock is not terminal input.
 */
export function shouldSuppressForImeComposition(ev: {
  type?: string;
  key?: string;
  code?: string;
  keyCode?: number;
  which?: number;
} | null): boolean {
  if (!ev || ev.type !== "keydown") return false;
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (keyCode === 20) return true;
  if (String(ev.key || "") === "CapsLock") return true;
  return String(ev.code || "") === "CapsLock";
}
