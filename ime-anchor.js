/**
 * Anchor xterm.js IME (textarea + composition-view) to the visible TUI caret.
 *
 * Ink-based AI CLIs leave the hardware cursor at the end of a row (often the
 * right edge of the input/placeholder). xterm positions IME there. Ink draws
 * the real caret as an isolated inverse-video cell — we pin IME to that cell.
 *
 * Adapted from the MIT-licensed approach in xterm-ime-anchor (msdshsk).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SeMaImeAnchor = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * @param {{ viewportY: number, getLine: (y: number) => any }} buf
   * @param {number} rows
   * @param {boolean} requireIsolatedCell
   * @returns {{ col: number, row: number } | null}
   */
  function findIsolatedInverseCell(buf, rows, requireIsolatedCell) {
    const startY = buf.viewportY;
    for (let y = startY + rows - 1; y >= startY; y--) {
      const line = buf.getLine(y);
      if (!line) continue;
      for (let x = line.length - 1; x >= 0; x--) {
        const cell = line.getCell(x);
        if (!cell || !cell.isInverse()) continue;

        if (requireIsolatedCell) {
          const left = x > 0 ? line.getCell(x - 1) : null;
          const right = x + 1 < line.length ? line.getCell(x + 1) : null;
          const leftInv = !!(left && left.isInverse());
          const rightInv = !!(right && right.isInverse());
          if (leftInv && rightInv) continue;
        }

        return { col: x, row: y - startY };
      }
    }
    return null;
  }

  /**
   * @param {any} terminal xterm Terminal instance (must be opened)
   * @param {{ onAnchor?: Function, requireIsolatedCell?: boolean }} [options]
   * @returns {{ detach: () => void }}
   */
  function attachImeHeuristic(terminal, options) {
    const opts = options || {};
    const onAnchor = opts.onAnchor;
    const requireIsolatedCell =
      opts.requireIsolatedCell === undefined ? true : !!opts.requireIsolatedCell;

    const root = terminal && terminal.element;
    if (!root || typeof root.querySelector !== "function") {
      return { detach() {} };
    }

    const textarea = root.querySelector(".xterm-helper-textarea");
    const screen = root.querySelector(".xterm-screen");
    const compositionView = root.querySelector(".composition-view");
    if (!textarea || !screen || !compositionView) {
      return { detach() {} };
    }

    let composing = false;
    let pinned = null;
    let renderDisposable = null;

    function reapply(el) {
      if (!composing || !pinned) return;
      if (el.style.left !== pinned.left || el.style.top !== pinned.top) {
        el.style.setProperty("left", pinned.left, "important");
        el.style.setProperty("top", pinned.top, "important");
      }
    }

    const moTa = new MutationObserver(() => reapply(textarea));
    const moCv = new MutationObserver(() => reapply(compositionView));

    function computeCellSize() {
      const rect = screen.getBoundingClientRect();
      return {
        w: rect.width / Math.max(terminal.cols, 1),
        h: rect.height / Math.max(terminal.rows, 1),
      };
    }

    function pinTo(hit) {
      const { w, h } = computeCellSize();
      const left = `${Math.round(hit.col * w)}px`;
      const top = `${Math.round(hit.row * h)}px`;
      if (pinned && pinned.left === left && pinned.top === top) return;
      pinned = { left, top };
      textarea.style.setProperty("left", left, "important");
      textarea.style.setProperty("top", top, "important");
      compositionView.style.setProperty("left", left, "important");
      compositionView.style.setProperty("top", top, "important");
      if (onAnchor) onAnchor({ source: "heuristic", col: hit.col, row: hit.row });
    }

    function recomputeAndPin() {
      if (!composing) return;
      const hit = findIsolatedInverseCell(
        terminal.buffer.active,
        terminal.rows,
        requireIsolatedCell
      );
      if (!hit) return;
      pinTo(hit);
    }

    function onCompositionStart() {
      composing = true;
      const hit = findIsolatedInverseCell(
        terminal.buffer.active,
        terminal.rows,
        requireIsolatedCell
      );
      if (!hit) {
        pinned = null;
        if (onAnchor) {
          onAnchor({
            source: "hardware",
            col: terminal.buffer.active.cursorX,
            row: terminal.buffer.active.cursorY,
          });
        }
      } else {
        pinTo(hit);
      }
      if (typeof terminal.onRender === "function") {
        renderDisposable = terminal.onRender(() => recomputeAndPin());
      }
    }

    function onCompositionEnd() {
      composing = false;
      pinned = null;
      if (renderDisposable) {
        renderDisposable.dispose();
        renderDisposable = null;
      }
    }

    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
    moTa.observe(textarea, { attributes: true, attributeFilter: ["style"] });
    moCv.observe(compositionView, {
      attributes: true,
      attributeFilter: ["style"],
    });

    return {
      detach() {
        composing = false;
        pinned = null;
        if (renderDisposable) {
          renderDisposable.dispose();
          renderDisposable = null;
        }
        textarea.removeEventListener("compositionstart", onCompositionStart);
        textarea.removeEventListener("compositionend", onCompositionEnd);
        moTa.disconnect();
        moCv.disconnect();
      },
    };
  }

  return { findIsolatedInverseCell, attachImeHeuristic };
});
