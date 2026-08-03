/**
 * Decide copy/paste for terminal key events.
 * Win/Linux: Ctrl+C (with selection) / Ctrl+Shift+C = copy; Ctrl+V / Ctrl+Shift+V = paste.
 * macOS: Cmd+C (with selection) = copy; Cmd+V = paste. Ctrl+C stays SIGINT.
 * @param {{ type?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} ev
 * @param {{ hasSelection: boolean, isMac: boolean }} opts
 * @returns {'copy'|'paste'|null}
 */
function clipboardAction(ev, opts) {
  if (!ev || ev.type !== "keydown") return null;
  const key = String(ev.key || "").toLowerCase();
  const hasSelection = !!(opts && opts.hasSelection);
  const isMac = !!(opts && opts.isMac);

  if (isMac) {
    if (!ev.metaKey) return null;
    if (key === "c") return hasSelection ? "copy" : null;
    if (key === "v") return "paste";
    return null;
  }

  if (!ev.ctrlKey) return null;
  if (key === "c") {
    if (ev.shiftKey || hasSelection) return "copy";
    return null;
  }
  if (key === "v") return "paste";
  return null;
}

/**
 * Line selection keys.
 * Win/Linux: Shift+Home / Shift+End (no Ctrl/Meta/Alt).
 * macOS: same, plus Cmd+Shift+← / Cmd+Shift+→ (laptop keyboards often lack Home/End).
 * @param {{ type?: string, key?: string, code?: string, keyCode?: number, which?: number, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} ev
 * @param {{ isMac?: boolean }} [opts]
 * @returns {'home'|'end'|null}
 */
function lineSelectAction(ev, opts) {
  if (!ev || ev.type !== "keydown" || !ev.shiftKey) return null;
  const isMac = !!(opts && opts.isMac);
  const key = String(ev.key || "");

  if (isMac) {
    if (ev.ctrlKey || ev.altKey) return null;
    if (ev.metaKey) {
      if (key === "ArrowLeft") return "home";
      if (key === "ArrowRight") return "end";
      return null;
    }
    if (key === "Home") return "home";
    if (key === "End") return "end";
    return null;
  }

  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  if (key === "Home") return "home";
  if (key === "End") return "end";
  return null;
}

/**
 * @param {number} cursorX
 * @param {number} cols
 * @param {'home'|'end'} which
 * @returns {{ column: number, length: number }}
 */
function lineSelectRange(cursorX, cols, which) {
  const x = Math.max(0, Math.min(Number(cursorX) || 0, Number(cols) || 0));
  const c = Math.max(0, Number(cols) || 0);
  if (which === "home") return { column: 0, length: x };
  return { column: x, length: Math.max(0, c - x) };
}

/**
 * Character selection keys (same row as cursor).
 * Win/Linux/macOS: Shift+← / Shift+→ (no Ctrl/Meta/Alt).
 * macOS Cmd+Shift+←/→ stays line-select in lineSelectAction.
 * Matches key, code, or keyCode (37/39) for broader OS/IME coverage.
 * @param {{ type?: string, key?: string, code?: string, keyCode?: number, which?: number, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} ev
 * @param {{ isMac?: boolean }} [opts]
 * @returns {'left'|'right'|null}
 */
function charSelectAction(ev, opts) {
  if (!ev || ev.type !== "keydown" || !ev.shiftKey) return null;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  void opts;
  const key = String(ev.key || "");
  const code = String(ev.code || "");
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (
    key === "ArrowLeft" ||
    key === "Left" ||
    code === "ArrowLeft" ||
    keyCode === 37
  ) {
    return "left";
  }
  if (
    key === "ArrowRight" ||
    key === "Right" ||
    code === "ArrowRight" ||
    keyCode === 39
  ) {
    return "right";
  }
  return null;
}

/**
 * Move the active end one cell; anchor stays fixed (editor-style Shift+arrows).
 * @param {number} cols
 * @param {'left'|'right'} direction
 * @param {number} anchorX
 * @param {number} activeX
 * @returns {{ activeX: number, column: number, length: number }}
 */
function charSelectRange(cols, direction, anchorX, activeX) {
  const maxX = Math.max(0, Number(cols) || 0);
  const anchor = Math.max(0, Math.min(Number(anchorX) || 0, maxX));
  let active = Math.max(0, Math.min(Number(activeX) || 0, maxX));
  if (direction === "left") active = Math.max(0, active - 1);
  else active = Math.min(maxX, active + 1);
  const lo = Math.min(anchor, active);
  const hi = Math.max(anchor, active);
  return { activeX: active, column: lo, length: hi - lo };
}

/**
 * Delete/Backspace with a selection → erase via N backspaces to the PTY.
 * Best when selection is the chars immediately before the cursor (typical input edit).
 * Win/macOS: same binding (no modifiers).
 * @param {{ type?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} ev
 * @param {{ hasSelection: boolean }} opts
 * @returns {'deleteSelection'|null}
 */
function selectionDeleteAction(ev, opts) {
  if (!ev || ev.type !== "keydown") return null;
  if (!(opts && opts.hasSelection)) return null;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  const key = String(ev.key || "");
  if (key === "Backspace" || key === "Delete") return "deleteSelection";
  return null;
}

/**
 * PTY payload: one DEL (\x7f) per code point in the selection.
 * @param {string} text
 * @returns {string}
 */
function selectionDeletePayload(text) {
  const n = Array.from(String(text ?? "")).length;
  return n > 0 ? "\x7f".repeat(n) : "";
}

/**
 * Ctrl+U → clear input line (readline kill-line). Same on Win/macOS (not Cmd+U).
 * @param {{ type?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} ev
 * @returns {'clearLine'|null}
 */
function lineClearAction(ev) {
  if (!ev || ev.type !== "keydown") return null;
  if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return null;
  if (String(ev.key || "").toLowerCase() === "u") return "clearLine";
  return null;
}

/** @type {string} */
const LINE_CLEAR_PAYLOAD = "\x15";

/**
 * Windows only: Ctrl+Z → readline undo.
 * IMPORTANT: do NOT send \\x1a (Ctrl+Z byte) — Windows console EOF; looks "卡住".
 * Claude Code / readline undo is Ctrl+_ → \\x1f. macOS Cmd+Z is left to the CLI (no remap).
 * @param {{ type?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} ev
 * @param {{ isMac?: boolean }} [opts]
 * @returns {'undo'|null}
 */
function undoAction(ev, opts) {
  if (!ev || ev.type !== "keydown") return null;
  // Mac: do not intercept — leave Cmd/Ctrl+Z to the CLI / terminal default.
  if (opts && opts.isMac) return null;
  if (ev.altKey || ev.shiftKey || ev.metaKey) return null;
  if (!ev.ctrlKey) return null;
  const key = String(ev.key || "").toLowerCase();
  const code = String(ev.code || "");
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (key === "z" || code === "KeyZ" || keyCode === 90) return "undo";
  return null;
}

/** Readline / Claude Code undo (Ctrl+_), NOT suspend (\\x1a). */
const UNDO_PAYLOAD = "\x1f";

module.exports = {
  clipboardAction,
  lineSelectAction,
  lineSelectRange,
  charSelectAction,
  charSelectRange,
  selectionDeleteAction,
  selectionDeletePayload,
  lineClearAction,
  LINE_CLEAR_PAYLOAD,
  undoAction,
  UNDO_PAYLOAD,
};
