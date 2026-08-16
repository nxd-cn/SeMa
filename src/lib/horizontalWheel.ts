/**
 * Map mouse wheel to horizontal scroll for overflow strips (split panes).
 * Shared Win + Mac path — normalize deltaMode so Windows LINE-mode mice
 * and Mac pixel trackpads both move a usable distance.
 *
 * Over xterm: leave vertical wheel for scrollback; allow Shift+wheel and
 * native horizontal trackpad deltas so the split strip still scrolls.
 */
export function applyHorizontalWheel(
  el: HTMLElement,
  e: WheelEvent
): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;

  const prefersHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (!e.shiftKey && !prefersHorizontal && isInsideXterm(e.target, el)) {
    return false;
  }

  const raw = prefersHorizontal ? e.deltaX : e.deltaY;
  const dx = wheelDeltaPixels(raw, e.deltaMode, el.clientWidth);
  if (!dx) return false;

  const max = el.scrollWidth - el.clientWidth;
  const next = Math.max(0, Math.min(max, el.scrollLeft + dx));
  if (next === el.scrollLeft) return false;

  e.preventDefault();
  el.scrollLeft = next;
  return true;
}

/** DOM_DELTA_PIXEL=0, LINE=1, PAGE=2 — Win mice often report LINE. */
export function wheelDeltaPixels(
  delta: number,
  deltaMode: number,
  pageSize: number
): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, pageSize);
  return delta;
}

function isInsideXterm(
  target: EventTarget | null,
  root: HTMLElement
): boolean {
  type WalkNode = {
    classList?: { contains(token: string): boolean };
    parentNode?: WalkNode | null;
  };
  let node = target as WalkNode | null;
  while (node && node !== root) {
    const cls = node.classList;
    if (
      cls?.contains("xterm") ||
      cls?.contains("xterm-viewport") ||
      cls?.contains("xterm-screen")
    ) {
      return true;
    }
    node = node.parentNode ?? null;
  }
  return false;
}
