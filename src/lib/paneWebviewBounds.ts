export type LogicalBounds = { x: number; y: number; w: number; h: number };

/** Minimum logical side before creating a child webview (WKWebView panics / nil NSURL with 0×0). */
export const MIN_WEBVIEW_SIDE = 8;

function snapLogical(n: number, dpr: number): number {
  return Math.round(n * dpr) / dpr;
}

/** Map viewport `getBoundingClientRect` CSS pixels to logical child-webview bounds.
 *  Output stays logical (Tauri `LogicalPosition` / `LogicalSize`); `dpr` only snaps
 *  to the physical pixel grid. Mac Overlay titlebar is already in the rect (`y`
 *  includes the 38px chrome) — do not add another offset. */
export function domRectToLogical(rect: DOMRect, dpr: number): LogicalBounds {
  const scale = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return {
    x: snapLogical(rect.x, scale),
    y: snapLogical(rect.y, scale),
    w: Math.max(0, snapLogical(rect.width, scale)),
    h: Math.max(0, snapLogical(rect.height, scale)),
  };
}

export function boundsReady(
  bounds: LogicalBounds,
  minSide: number = MIN_WEBVIEW_SIDE,
): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    bounds.w >= minSide &&
    bounds.h >= minSide
  );
}
