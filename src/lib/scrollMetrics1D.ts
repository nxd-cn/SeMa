/** 1-axis scrollbar math for custom DOM chrome bars (Win + Mac). */

export type ScrollMetrics1D = {
  pos: number;
  scrollSize: number;
  clientSize: number;
};

export type ScrollThumb1D = {
  visible: boolean;
  /** Thumb length along the track (px) */
  size: number;
  /** Thumb offset from track start (px) */
  offset: number;
};

const MIN_THUMB = 28;

export function scrollThumb1D(
  m: ScrollMetrics1D,
  trackSize: number
): ScrollThumb1D {
  if (
    trackSize <= 0 ||
    m.scrollSize <= m.clientSize + 1 ||
    m.clientSize <= 0
  ) {
    return { visible: false, size: 0, offset: 0 };
  }
  const size = Math.max(
    MIN_THUMB,
    (m.clientSize / m.scrollSize) * trackSize
  );
  const maxScroll = m.scrollSize - m.clientSize;
  const maxOffset = Math.max(0, trackSize - size);
  const offset = maxScroll > 0 ? (m.pos / maxScroll) * maxOffset : 0;
  return { visible: true, size, offset };
}

/** Map a pointer along the track to scroll position. */
export function scrollPosFromTrackPointer(
  m: ScrollMetrics1D,
  trackSize: number,
  pointer: number,
  thumbSize: number
): number {
  const maxScroll = m.scrollSize - m.clientSize;
  if (maxScroll <= 0 || trackSize <= thumbSize) return 0;
  const maxOffset = trackSize - thumbSize;
  const thumbOffset = Math.max(
    0,
    Math.min(maxOffset, pointer - thumbSize / 2)
  );
  return (thumbOffset / maxOffset) * maxScroll;
}

export function metricsFromElement(
  el: HTMLElement,
  axis: "x" | "y"
): ScrollMetrics1D {
  if (axis === "x") {
    return {
      pos: el.scrollLeft,
      scrollSize: el.scrollWidth,
      clientSize: el.clientWidth,
    };
  }
  return {
    pos: el.scrollTop,
    scrollSize: el.scrollHeight,
    clientSize: el.clientHeight,
  };
}

export function applyScrollPos(
  el: HTMLElement,
  axis: "x" | "y",
  pos: number
): void {
  if (axis === "x") el.scrollLeft = pos;
  else el.scrollTop = pos;
}
