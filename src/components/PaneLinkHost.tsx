import { useCallback, useEffect, useRef } from "react";
import { tui } from "../api/tui";
import { boundsReady, domRectToLogical } from "../lib/paneWebviewBounds";

export const LINK_OPEN_EXTERNAL_LABEL = "在系统浏览器打开";
export const LINK_LOAD_ERROR_MESSAGE = "无法在栏内打开此链接";

type Props = {
  paneId: string;
  url: string;
  visible: boolean;
  loadError?: boolean;
  onLoadError: () => void;
};

function readLogicalBounds(el: HTMLElement | null) {
  const rect = el?.getBoundingClientRect() ?? new DOMRect();
  const dpr = window.devicePixelRatio || 1;
  return domRectToLogical(rect, dpr);
}

export default function PaneLinkHost({
  paneId,
  url,
  visible,
  loadError,
  onLoadError,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const openedRef = useRef(false);

  const reportBounds = useCallback(() => {
    if (!visibleRef.current || !openedRef.current) return;
    const bounds = readLogicalBounds(hostRef.current);
    if (!boundsReady(bounds)) return;
    void tui
      .paneWebviewSetBounds({ id: paneId, ...bounds })
      .catch(() => {});
  }, [paneId]);

  useEffect(() => {
    if (loadError) return;
    let cancelled = false;
    openedRef.current = false;
    let raf = 0;
    let attempts = 0;

    const tryOpen = () => {
      if (cancelled) return;
      const bounds = readLogicalBounds(hostRef.current);
      if (!boundsReady(bounds)) {
        attempts += 1;
        if (attempts > 120) {
          // ~2s at 60fps — give up and surface fallback instead of 0×0 create.
          if (!cancelled) onLoadError();
          return;
        }
        raf = window.requestAnimationFrame(tryOpen);
        return;
      }
      void tui
        .paneWebviewOpen({ id: paneId, url, ...bounds })
        .then(() => {
          if (cancelled) {
            void tui.paneWebviewClose(paneId).catch(() => {});
            return;
          }
          openedRef.current = true;
          if (!visibleRef.current) {
            void tui
              .paneWebviewSetVisible({ id: paneId, visible: false })
              .catch(() => {});
            return;
          }
          reportBounds();
        })
        .catch(() => {
          openedRef.current = false;
          void tui.paneWebviewClose(paneId).catch(() => {});
          if (!cancelled) onLoadError();
        });
    };

    raf = window.requestAnimationFrame(tryOpen);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [paneId, url, loadError, onLoadError, reportBounds]);

  useEffect(() => {
    return () => {
      openedRef.current = false;
      void tui.paneWebviewClose(paneId).catch(() => {});
    };
  }, [paneId]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reportBounds());
    ro.observe(el);
    window.addEventListener("resize", reportBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reportBounds);
    };
  }, [reportBounds]);

  useEffect(() => {
    if (visible) reportBounds();
  }, [visible, reportBounds]);

  return (
    <div className="pane-link-host" ref={hostRef}>
      {loadError ? (
        <div className="pane-link-fallback">
          <p className="pane-link-fallback-msg">{LINK_LOAD_ERROR_MESSAGE}</p>
          <button
            type="button"
            className="pane-link-open-external"
            onClick={() => void tui.openExternal(url)}
          >
            {LINK_OPEN_EXTERNAL_LABEL}
          </button>
        </div>
      ) : null}
    </div>
  );
}
