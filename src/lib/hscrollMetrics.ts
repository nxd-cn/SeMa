/** Horizontal adapters over scrollMetrics1D (term-columns). */
import {
  scrollPosFromTrackPointer as posFromPointer,
  scrollThumb1D,
} from "./scrollMetrics1D";

export type HScrollMetrics = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

export type HScrollThumb = {
  visible: boolean;
  width: number;
  left: number;
};

export function hscrollThumb(
  m: HScrollMetrics,
  trackWidth: number
): HScrollThumb {
  const t = scrollThumb1D(
    { pos: m.scrollLeft, scrollSize: m.scrollWidth, clientSize: m.clientWidth },
    trackWidth
  );
  return { visible: t.visible, width: t.size, left: t.offset };
}

export function scrollLeftFromTrackPointer(
  m: HScrollMetrics,
  trackWidth: number,
  pointerX: number,
  thumbWidth: number
): number {
  return posFromPointer(
    { pos: m.scrollLeft, scrollSize: m.scrollWidth, clientSize: m.clientWidth },
    trackWidth,
    pointerX,
    thumbWidth
  );
}
