/** Position a portaled artifacts menu anchored to its trigger button. */
export function placeArtifactsDropdown(
  anchor: HTMLElement,
  panel: HTMLElement,
) {
  const pad = 4;
  const rect = anchor.getBoundingClientRect();
  const w = panel.offsetWidth || 240;
  const h = panel.offsetHeight || 180;
  let left = rect.right - w;
  let top = rect.bottom + pad;
  if (top + h > window.innerHeight - pad) {
    top = rect.top - h - pad;
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

export function linkPreviewHoldLabel(url: string): string {
  if (url.startsWith("file:")) {
    try {
      const pathname = decodeURIComponent(new URL(url).pathname);
      const normalized = pathname.replace(/^\/([A-Za-z]:)/, "$1");
      const base = normalized.split("/").filter(Boolean).pop();
      if (base) return base;
    } catch {
      /* fall through */
    }
  }
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
