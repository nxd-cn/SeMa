/**
 * Keys that must not reach xterm CompositionHelper while IME may be active.
 *
 * On macOS, CapsLock toggles Chinese IME ↔ English. xterm 5.5 treats CapsLock
 * (keyCode 20) as a non-modifier during composition and early-finalizes, then
 * compositionend sends the same text again → duplicate characters.
 * Upstream fix: xterm.js #5282 (shipped in 6.0). We swallow CapsLock in the
 * custom key handler so CompositionHelper never sees it (same effect).
 *
 * Safe on Windows too: CapsLock is not terminal input.
 *
 * @param {{ type?: string, key?: string, keyCode?: number, which?: number } | null | undefined} ev
 * @returns {boolean} true → custom handler should return false (stop xterm processing)
 */
function shouldSuppressForImeComposition(ev) {
  if (!ev || ev.type !== "keydown") return false;
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (keyCode === 20) return true;
  return String(ev.key || "") === "CapsLock";
}

module.exports = { shouldSuppressForImeComposition };
