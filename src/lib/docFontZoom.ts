import { wheelDeltaPixels } from "./horizontalWheel";

/** Base font size for xterm session panes (px). */
export const DEFAULT_TERM_FONT_SIZE = 11;
export const MIN_TERM_FONT_SIZE = 8;
export const MAX_TERM_FONT_SIZE = 24;

export function clampTermFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERM_FONT_SIZE;
  return Math.min(
    MAX_TERM_FONT_SIZE,
    Math.max(MIN_TERM_FONT_SIZE, Math.round(size)),
  );
}

/** Base font size for pane doc editor / markdown preview (px). */
export const DEFAULT_DOC_FONT_SIZE = 13;
export const MIN_DOC_FONT_SIZE = 10;
export const MAX_DOC_FONT_SIZE = 28;

export function clampDocFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_DOC_FONT_SIZE;
  return Math.min(
    MAX_DOC_FONT_SIZE,
    Math.max(MIN_DOC_FONT_SIZE, Math.round(size)),
  );
}

/**
 * Win: Ctrl+wheel.
 * Mac: ⌘+wheel, ⌃+wheel, or trackpad pinch (WebKit sets ctrlKey on pinch).
 */
export function isDocFontZoomWheel(
  ev: Pick<WheelEvent, "ctrlKey" | "metaKey" | "altKey">,
  isMac: boolean,
): boolean {
  if (ev.altKey) return false;
  if (isMac) return ev.metaKey || ev.ctrlKey;
  return ev.ctrlKey && !ev.metaKey;
}

/**
 * One wheel notch → ±1px. Returns null when the gesture is not a font-zoom wheel.
 * Caller should preventDefault when non-null (including at min/max) to block webview zoom.
 */
export function docFontSizeFromWheel(
  current: number,
  e: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "altKey">,
  opts: { isMac: boolean; pageSize?: number },
): number | null {
  return fontSizeStepFromWheel(current, e, {
    ...opts,
    clamp: clampDocFontSize,
  });
}

export function termFontSizeFromWheel(
  current: number,
  e: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "altKey">,
  opts: { isMac: boolean; pageSize?: number },
): number | null {
  return fontSizeStepFromWheel(current, e, {
    ...opts,
    clamp: clampTermFontSize,
  });
}

function fontSizeStepFromWheel(
  current: number,
  e: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "altKey">,
  opts: { isMac: boolean; pageSize?: number; clamp: (size: number) => number },
): number | null {
  if (!isDocFontZoomWheel(e, opts.isMac)) return null;
  const dy = wheelDeltaPixels(
    e.deltaY,
    e.deltaMode,
    opts.pageSize ?? 400,
  );
  if (!dy) return opts.clamp(current);
  const step = dy > 0 ? -1 : 1;
  return opts.clamp(current + step);
}

export function docFontZoomShortcutLabel(isMac: boolean): string {
  return isMac ? "⌃+滚轮或双指捏合" : "Ctrl+滚轮";
}
