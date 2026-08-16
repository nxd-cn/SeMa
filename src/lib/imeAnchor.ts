/**
 * Anchor xterm.js IME (textarea + composition-view) to the visible TUI caret.
 *
 * Ink-based AI CLIs leave the hardware cursor at the end of a row (often the
 * right edge of the input/placeholder). xterm positions IME there. Ink draws
 * the real caret as an isolated inverse-video cell — we pin IME to that cell.
 *
 * Adapted from the MIT-licensed approach in xterm-ime-anchor (msdshsk).
 */

export type ImeAnchorHit = { col: number; row: number };

type BufferLineLike = {
  length: number;
  getCell: (x: number) => { isInverse: () => boolean | number } | null | undefined;
};

type BufferLike = {
  viewportY: number;
  getLine: (y: number) => BufferLineLike | null | undefined;
};

export type ImeAnchorOptions = {
  onAnchor?: (info: {
    source: "heuristic" | "hardware";
    col: number;
    row: number;
  }) => void;
  /** Skip interior cells of a contiguous inverse run (default true). */
  requireIsolatedCell?: boolean;
};

export type ImeAnchorHandle = { detach: () => void };

/** Minimal Terminal surface used by the anchor (avoids coupling to xterm types). */
export type ImeAnchorTerminal = {
  element: HTMLElement | null | undefined;
  cols: number;
  rows: number;
  buffer: {
    active: BufferLike & { cursorX: number; cursorY: number };
  };
  onRender?: (cb: () => void) => { dispose: () => void };
};

export function findIsolatedInverseCell(
  buf: BufferLike,
  rows: number,
  requireIsolatedCell: boolean
): ImeAnchorHit | null {
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

export function attachImeHeuristic(
  terminal: ImeAnchorTerminal,
  options?: ImeAnchorOptions
): ImeAnchorHandle {
  const opts = options || {};
  const onAnchor = opts.onAnchor;
  const requireIsolatedCell =
    opts.requireIsolatedCell === undefined ? true : !!opts.requireIsolatedCell;

  const root = terminal?.element;
  if (!root || typeof root.querySelector !== "function") {
    return { detach() {} };
  }

  const textarea = root.querySelector(".xterm-helper-textarea") as HTMLElement | null;
  const screen = root.querySelector(".xterm-screen") as HTMLElement | null;
  const compositionView = root.querySelector(".composition-view") as HTMLElement | null;
  if (!textarea || !screen || !compositionView) {
    return { detach() {} };
  }

  let composing = false;
  let pinned: { left: string; top: string } | null = null;
  let renderDisposable: { dispose: () => void } | null = null;

  function reapply(el: HTMLElement) {
    if (!composing || !pinned) return;
    if (el.style.left !== pinned.left || el.style.top !== pinned.top) {
      el.style.setProperty("left", pinned.left, "important");
      el.style.setProperty("top", pinned.top, "important");
    }
  }

  const moTa = new MutationObserver(() => reapply(textarea));
  const moCv = new MutationObserver(() => reapply(compositionView));

  function computeCellSize() {
    const rect = screen!.getBoundingClientRect();
    return {
      w: rect.width / Math.max(terminal.cols, 1),
      h: rect.height / Math.max(terminal.rows, 1),
    };
  }

  function pinTo(hit: ImeAnchorHit) {
    const { w, h } = computeCellSize();
    const left = `${Math.round(hit.col * w)}px`;
    const top = `${Math.round(hit.row * h)}px`;
    if (pinned && pinned.left === left && pinned.top === top) return;
    pinned = { left, top };
    textarea!.style.setProperty("left", left, "important");
    textarea!.style.setProperty("top", top, "important");
    compositionView!.style.setProperty("left", left, "important");
    compositionView!.style.setProperty("top", top, "important");
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
