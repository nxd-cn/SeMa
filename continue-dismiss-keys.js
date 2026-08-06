/**
 * Detect "user submitted a chat turn" key for dismissing ↻ / arming activity.
 *
 * Shared Windows + macOS behavior:
 * - Enter / NumpadEnter dismiss (including Ctrl/Cmd+Enter used by some CLIs)
 * - Skip while CJK IME is composing (macOS pinyin confirm often uses Enter;
 *   keyCode 229 = IME "Process" on both platforms)
 *
 * @param {{
 *   type?: string,
 *   key?: string,
 *   code?: string,
 *   keyCode?: number,
 *   which?: number,
 *   isComposing?: boolean,
 * } | null | undefined} ev
 * @returns {'submit'|null}
 */
function chatSubmitKeyAction(ev) {
  if (!ev || ev.type !== "keydown") return null;
  if (ev.isComposing) return null;
  const keyCode = Number(ev.keyCode || ev.which || 0);
  // IME composition / Process key — do not treat as chat submit.
  if (keyCode === 229) return null;

  const key = String(ev.key || "");
  const code = String(ev.code || "");
  const isEnter =
    key === "Enter" ||
    code === "Enter" ||
    code === "NumpadEnter" ||
    keyCode === 13;
  if (!isEnter) return null;
  return "submit";
}

/**
 * PTY / paste payload that means the user sent a line (Enter or multiline paste).
 * Same on Windows (often \\r) and macOS (\\r or \\n).
 *
 * @param {unknown} data
 * @returns {boolean}
 */
function dataLooksLikeSubmit(data) {
  if (data == null) return false;
  const s = typeof data === "string" ? data : String(data);
  return (
    s === "\r" ||
    s === "\n" ||
    s.indexOf("\r") !== -1 ||
    s.indexOf("\n") !== -1
  );
}

module.exports = { chatSubmitKeyAction, dataLooksLikeSubmit };
