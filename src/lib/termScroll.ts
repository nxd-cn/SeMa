/**
 * Preserve xterm scrollback position across fit/resize.
 *
 * When a sibling pane opens (top-right CLI), flex shrinks the host. During
 * that layout pass the viewport scrollTop can briefly become 0; xterm then
 * treats it as a user scroll and sets ydisp → 0 (jump to top of history).
 */

export type TermScrollSnapshot = {
  viewportY: number;
  atBottom: boolean;
};

export type BufferScrollLike = {
  viewportY: number;
  baseY: number;
};

export function captureTermScroll(buf: BufferScrollLike): TermScrollSnapshot {
  const viewportY = buf.viewportY | 0;
  const baseY = buf.baseY | 0;
  return {
    viewportY,
    atBottom: viewportY >= baseY,
  };
}

export type TermScrollTarget = {
  scrollToBottom: () => void;
  scrollToLine: (line: number) => void;
};

/** Restore after fit/resize. Prefer bottom when we were pinned there. */
export function restoreTermScroll(
  term: TermScrollTarget,
  snap: TermScrollSnapshot
): void {
  try {
    if (snap.atBottom) term.scrollToBottom();
    else term.scrollToLine(Math.max(0, snap.viewportY | 0));
  } catch {
    /* ignore */
  }
}

/** Only re-focus after resize if this terminal already owned focus. */
export function termOwnsFocus(
  textarea: Element | null | undefined,
  active: Element | null | undefined
): boolean {
  return !!textarea && !!active && active === textarea;
}
