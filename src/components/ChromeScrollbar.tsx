import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  applyScrollPos,
  metricsFromElement,
  scrollPosFromTrackPointer,
  scrollThumb1D,
  type ScrollMetrics1D,
} from "../lib/scrollMetrics1D";

type Props = {
  axis: "x" | "y";
  scrollRef: RefObject<HTMLElement | null>;
  /** Remeasure when content layout changes. */
  layoutKey: string;
  trackClassName: string;
  thumbClassName: string;
  /** Toggled on the track's parent when overflowing (native bar clip). */
  overflowParentClass?: string;
};

/**
 * Custom scrollbar matching SeMa chrome colors.
 * Needed because macOS WKWebView ignores ::-webkit-scrollbar.
 * Shared by term-columns (x) and sidebar tabs (y).
 */
export default function ChromeScrollbar({
  axis,
  scrollRef,
  layoutKey,
  trackClassName,
  thumbClassName,
  overflowParentClass,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics1D>({
    pos: 0,
    scrollSize: 0,
    clientSize: 0,
  });
  const [trackSize, setTrackSize] = useState(0);
  const drag = useRef<{ startPointer: number; startScroll: number } | null>(
    null
  );
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (el) setMetrics(metricsFromElement(el, axis));
    if (track) {
      setTrackSize(axis === "x" ? track.clientWidth : track.clientHeight);
    }
  }, [scrollRef, axis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const onScroll = () => measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      measure();
    });
    mo.observe(el, { childList: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollRef, layoutKey, measure]);

  const overflow = metrics.scrollSize > metrics.clientSize + 1;

  useLayoutEffect(() => {
    measure();
  }, [overflow, layoutKey, measure]);

  useLayoutEffect(() => {
    if (!overflowParentClass) return;
    const shell = trackRef.current?.parentElement;
    if (!shell) return;
    shell.classList.toggle(overflowParentClass, overflow);
  }, [overflow, overflowParentClass]);

  const thumb = scrollThumb1D(metrics, trackSize);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = scrollRef.current;
      const d = drag.current;
      const track = trackRef.current;
      if (!el || !d || !track) return;
      const ts = axis === "x" ? track.clientWidth : track.clientHeight;
      const m = metricsFromElement(el, axis);
      const t = scrollThumb1D(m, ts);
      if (!t.visible) return;
      const maxScroll = m.scrollSize - m.clientSize;
      const maxOffset = ts - t.size;
      if (maxOffset <= 0 || maxScroll <= 0) return;
      const pointer = axis === "x" ? e.clientX : e.clientY;
      const delta = pointer - d.startPointer;
      const startOffset = (d.startScroll / maxScroll) * maxOffset;
      const nextOffset = Math.max(0, Math.min(maxOffset, startOffset + delta));
      applyScrollPos(el, axis, (nextOffset / maxOffset) * maxScroll);
    };
    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, scrollRef, axis]);

  const onTrackPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest(`.${thumbClassName}`)) return;
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const ts = axis === "x" ? track.clientWidth : track.clientHeight;
    const m = metricsFromElement(el, axis);
    const t = scrollThumb1D(m, ts);
    if (!t.visible) return;
    const pointer =
      axis === "x" ? e.clientX - rect.left : e.clientY - rect.top;
    applyScrollPos(
      el,
      axis,
      scrollPosFromTrackPointer(m, ts, pointer, t.size)
    );
    measure();
  };

  const onThumbPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    drag.current = {
      startPointer: axis === "x" ? e.clientX : e.clientY,
      startScroll: axis === "x" ? el.scrollLeft : el.scrollTop,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const thumbStyle =
    axis === "x"
      ? { width: thumb.size, left: thumb.offset }
      : { height: thumb.size, top: thumb.offset };

  return (
    <div
      ref={trackRef}
      className={`${trackClassName}${overflow ? " visible" : ""}`}
      aria-hidden={!overflow}
      onPointerDown={overflow ? onTrackPointerDown : undefined}
    >
      {overflow && thumb.visible ? (
        <div
          className={`${thumbClassName}${dragging ? " dragging" : ""}`}
          style={thumbStyle}
          onPointerDown={onThumbPointerDown}
        />
      ) : null}
    </div>
  );
}
