/**
 * Keep xterm helper textarea usable for caret / IME after dispose/refocus races.
 *
 * xterm parks the textarea at left:-9999em with width/height 0 until
 * _syncTextArea runs. That sync no-ops when the cursor is off-viewport, so
 * after closing another pane Windows IME often cannot attach.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SeMaTermInputRecover = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * @param {{ style?: CSSStyleDeclaration } | null | undefined} textarea
   * @returns {boolean} true if styles were patched
   */
  function ensureTextareaReadyForIme(textarea) {
    if (!textarea || !textarea.style) return false;
    let patched = false;
    const inlineH = String(textarea.style.height || "");
    if (inlineH === "0px" || inlineH === "0") {
      textarea.style.height = "1px";
      textarea.style.width = "1px";
      textarea.style.lineHeight = "1px";
      patched = true;
    }
    let computedLeft = "";
    try {
      if (typeof window !== "undefined" && window.getComputedStyle) {
        computedLeft = String(window.getComputedStyle(textarea).left || "");
      }
    } catch (_) {}
    const left = String(textarea.style.left || computedLeft || "");
    if (left.indexOf("-9999") !== -1) {
      textarea.style.left = "0px";
      textarea.style.top = "0px";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.lineHeight = "1px";
      patched = true;
    }
    return patched;
  }

  /**
   * Blur a terminal before dispose so Chromium does not keep a dead focused node.
   * @param {{ textarea?: { blur?: () => void }, blur?: () => void } | null | undefined} term
   */
  function blurTermForDispose(term) {
    if (!term) return;
    try {
      if (term.textarea && typeof term.textarea.blur === "function") {
        term.textarea.blur();
      }
    } catch (_) {}
    try {
      if (typeof term.blur === "function") term.blur();
    } catch (_) {}
  }

  return { ensureTextareaReadyForIme, blurTermForDispose };
});
