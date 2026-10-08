/**
 * Attach a draggable chrome horizontal scrollbar under overflowing <pre>
 * blocks inside Chat markdown. Native bars are unreliable in WebView2 /
 * WKWebView (inherited scrollbar-width:none, Mac ignores ::-webkit-scrollbar).
 */

import {
  applyScrollPos,
  metricsFromElement,
  scrollPosFromTrackPointer,
  scrollThumb1D,
} from "./scrollMetrics1D";

const SHELL = "chat-pre-shell";
const TRACK = "chat-pre-hscroll";
const THUMB = "chat-pre-hscroll-thumb";
const ENHANCED = "data-chat-hscroll";

type Attach = { pre: HTMLElement; dispose: () => void };

/**
 * Find all <pre> under root, wrap overflowing ones with a chrome h-scroll bar.
 * Returns a disposer that tears down listeners (shells stay for React re-use).
 */
export function syncChatPreHScroll(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const attaches: Attach[] = [];

  const pres = root.querySelectorAll<HTMLElement>("pre");
  for (const pre of Array.from(pres)) {
    // Skip plain user-bubble pre (pre-wrap, not a fence).
    if (
      pre.classList.contains("chat-bubble-text") &&
      !pre.closest(".chat-md")
    ) {
      continue;
    }
    const dispose = attachOne(pre);
    if (dispose) attaches.push({ pre, dispose });
  }

  return () => {
    for (const a of attaches) a.dispose();
  };
}

function ensureShell(pre: HTMLElement): {
  shell: HTMLElement;
  track: HTMLElement;
  thumb: HTMLElement;
} {
  let shell = pre.parentElement;
  if (!shell || !shell.classList.contains(SHELL)) {
    shell = document.createElement("div");
    shell.className = SHELL;
    pre.parentNode?.insertBefore(shell, pre);
    shell.appendChild(pre);
  }
  let track = shell.querySelector<HTMLElement>(`:scope > .${TRACK}`);
  if (!track) {
    track = document.createElement("div");
    track.className = TRACK;
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("div");
    thumb.className = THUMB;
    track.appendChild(thumb);
    shell.appendChild(track);
  }
  const thumb =
    track.querySelector<HTMLElement>(`:scope > .${THUMB}`) ||
    (() => {
      const t = document.createElement("div");
      t.className = THUMB;
      track!.appendChild(t);
      return t;
    })();
  return { shell, track, thumb };
}

function attachOne(pre: HTMLElement): (() => void) | null {
  const { track, thumb } = ensureShell(pre);
  pre.setAttribute(ENHANCED, "1");

  let dragCleanup: (() => void) | null = null;

  const measure = () => {
    const m = metricsFromElement(pre, "x");
    const overflow = m.scrollSize > m.clientSize + 1;
    track.classList.toggle("visible", overflow);
    if (!overflow) {
      thumb.style.width = "0";
      thumb.style.left = "0";
      return;
    }
    const t = scrollThumb1D(m, track.clientWidth);
    if (!t.visible) {
      track.classList.remove("visible");
      return;
    }
    thumb.style.width = `${t.size}px`;
    thumb.style.left = `${t.offset}px`;
  };

  const onScroll = () => measure();
  pre.addEventListener("scroll", onScroll, { passive: true });

  const ro = new ResizeObserver(() => measure());
  ro.observe(pre);
  ro.observe(track);

  const onTrackDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(`.${THUMB}`)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    const m = metricsFromElement(pre, "x");
    const t = scrollThumb1D(m, track.clientWidth);
    if (!t.visible) return;
    const pointer = e.clientX - rect.left;
    applyScrollPos(
      pre,
      "x",
      scrollPosFromTrackPointer(m, track.clientWidth, pointer, t.size)
    );
    measure();
  };

  const onThumbDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCleanup?.();

    const startPointer = e.clientX;
    const startScroll = pre.scrollLeft;
    thumb.classList.add("dragging");

    const onMove = (ev: PointerEvent | MouseEvent) => {
      ev.preventDefault();
      const m = metricsFromElement(pre, "x");
      const t = scrollThumb1D(m, track.clientWidth);
      const thumbSize = t.visible ? t.size : 28;
      const maxScroll = m.scrollSize - m.clientSize;
      const maxOffset = track.clientWidth - thumbSize;
      if (maxOffset <= 0 || maxScroll <= 0) return;
      const delta = ev.clientX - startPointer;
      const startOffset = (startScroll / maxScroll) * maxOffset;
      const nextOffset = Math.max(0, Math.min(maxOffset, startOffset + delta));
      applyScrollPos(pre, "x", (nextOffset / maxOffset) * maxScroll);
    };

    const onUp = () => {
      dragCleanup?.();
      dragCleanup = null;
      thumb.classList.remove("dragging");
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);

    dragCleanup = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
  };

  track.addEventListener("pointerdown", onTrackDown);
  thumb.addEventListener("pointerdown", onThumbDown);

  // Layout may not be final on first paint (streaming markdown).
  requestAnimationFrame(measure);
  window.setTimeout(measure, 50);
  window.setTimeout(measure, 200);

  return () => {
    dragCleanup?.();
    pre.removeEventListener("scroll", onScroll);
    ro.disconnect();
    track.removeEventListener("pointerdown", onTrackDown);
    thumb.removeEventListener("pointerdown", onThumbDown);
  };
}
