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

const MIN_THUMB_FALLBACK = 28;

/**
 * Custom scrollbar matching SeMa chrome colors.
 * Needed because macOS WKWebView ignores ::-webkit-scrollbar.
 * Shared by term-columns (x) and chrome-vscroll (y).
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
  const [dragging, setDragging] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
      dragCleanup.current = null;
    };
  }, []);

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
  const showThumb = dragging || (overflow && thumb.visible);

  const onTrackPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest(`.${thumbClassName}`)) return;
    e.preventDefault();
    e.stopPropagation();
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
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    // End any prior drag (StrictMode / double-down).
    dragCleanup.current?.();

    const startPointer = axis === "x" ? e.clientX : e.clientY;
    const startScroll = axis === "x" ? el.scrollLeft : el.scrollTop;
    setDragging(true);

    // Register move/up synchronously — waiting for useEffect(dragging) drops
    // the first moves and is flaky in WebView2 / WKWebView.
    const onMove = (ev: PointerEvent) => {
      const port = scrollRef.current;
      const tr = trackRef.current;
      if (!port || !tr) return;
      ev.preventDefault();
      ev.stopPropagation();
      const ts = axis === "x" ? tr.clientWidth : tr.clientHeight;
      const m = metricsFromElement(port, axis);
      const t = scrollThumb1D(m, ts);
      const thumbSize = t.visible ? t.size : Math.min(MIN_THUMB_FALLBACK, ts);
      const maxScroll = m.scrollSize - m.clientSize;
      const maxOffset = ts - thumbSize;
      if (maxOffset <= 0 || maxScroll <= 0) return;
      const pointer = axis === "x" ? ev.clientX : ev.clientY;
      const delta = pointer - startPointer;
      const startOffset = (startScroll / maxScroll) * maxOffset;
      const nextOffset = Math.max(0, Math.min(maxOffset, startOffset + delta));
      applyScrollPos(port, axis, (nextOffset / maxOffset) * maxScroll);
    };

    const onUp = () => {
      dragCleanup.current?.();
      dragCleanup.current = null;
      setDragging(false);
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    // Mouse fallback — some WebView builds drop pointer* after preventDefault.
    document.addEventListener("mousemove", onMove as EventListener, true);
    document.addEventListener("mouseup", onUp, true);

    dragCleanup.current = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("mousemove", onMove as EventListener, true);
      document.removeEventListener("mouseup", onUp, true);
    };
  };

  const thumbStyle =
    axis === "x"
      ? { width: thumb.size || MIN_THUMB_FALLBACK, left: thumb.offset }
      : { height: thumb.size || MIN_THUMB_FALLBACK, top: thumb.offset };

  return (
    <div
      ref={trackRef}
      className={`${trackClassName}${overflow || dragging ? " visible" : ""}`}
      aria-hidden={!overflow && !dragging}
      onPointerDown={overflow || dragging ? onTrackPointerDown : undefined}
    >
      {showThumb ? (
        <div
          className={`${thumbClassName}${dragging ? " dragging" : ""}`}
          style={thumbStyle}
          onPointerDown={onThumbPointerDown}
        />
      ) : null}
    </div>
  );
}
