import { useCallback, useEffect, useRef, useState } from "react";
import { tui } from "../api/tui";
import { linkPreviewHoldLabel } from "../lib/artifactDropdownPlace";
import { boundsReady, domRectToLogical } from "../lib/paneWebviewBounds";

export const LINK_OPEN_EXTERNAL_LABEL = "在系统浏览器打开";
export const LINK_LOAD_ERROR_MESSAGE = "无法在栏内打开此链接";

type Props = {
  paneId: string;
  url: string;
  visible: boolean;
  /** Artifacts chrome menu open — hide native webview so the portaled menu stays on top. */
  chromeOverlayOpen?: boolean;
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
  chromeOverlayOpen = false,
  loadError,
  onLoadError,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const chromeOverlayOpenRef = useRef(chromeOverlayOpen);
  visibleRef.current = visible;
  chromeOverlayOpenRef.current = chromeOverlayOpen;
  const openedRef = useRef(false);
  const openGenRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);

  const webviewShown = () =>
    visibleRef.current && !chromeOverlayOpenRef.current;

  const closeWebview = useCallback(() => {
    openedRef.current = false;
    setWebviewReady(false);
    void tui.paneWebviewClose(paneId).catch(() => {});
  }, [paneId]);

  const reportBounds = useCallback(() => {
    if (!webviewShown() || !openedRef.current) return;
    const bounds = readLogicalBounds(hostRef.current);
    if (!boundsReady(bounds)) return;
    void tui
      .paneWebviewSetBounds({ id: paneId, ...bounds })
      .catch(() => {});
  }, [paneId]);

  const syncWebviewVisible = useCallback(() => {
    if (!openedRef.current) return;
    void tui
      .paneWebviewSetVisible({ id: paneId, visible: webviewShown() })
      .catch(() => {});
    if (webviewShown()) reportBounds();
  }, [paneId, reportBounds]);

  useEffect(() => {
    if (!loadError) return;
    setLoading(false);
    closeWebview();
  }, [loadError, closeWebview]);

  useEffect(() => {
    if (loadError) return;
    const gen = ++openGenRef.current;
    let cancelled = false;
    closeWebview();
    setLoading(true);
    let raf = 0;
    let attempts = 0;

    const stale = () => cancelled || gen !== openGenRef.current;

    const tryOpen = () => {
      if (stale()) return;
      const bounds = readLogicalBounds(hostRef.current);
      if (!boundsReady(bounds)) {
        attempts += 1;
        if (attempts > 120) {
          if (!stale()) {
            setLoading(false);
            onLoadError();
          }
          return;
        }
        raf = window.requestAnimationFrame(tryOpen);
        return;
      }
      void tui
        .paneWebviewOpen({ id: paneId, url, ...bounds })
        .then(() => {
          if (stale()) {
            closeWebview();
            return;
          }
          openedRef.current = true;
          setWebviewReady(true);
          setLoading(false);
          syncWebviewVisible();
        })
        .catch(() => {
          closeWebview();
          if (!stale()) {
            setLoading(false);
            onLoadError();
          }
        });
    };

    raf = window.requestAnimationFrame(tryOpen);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [paneId, url, loadError, onLoadError, closeWebview, syncWebviewVisible]);

  useEffect(() => {
    return () => {
      closeWebview();
    };
  }, [closeWebview]);

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
    syncWebviewVisible();
  }, [visible, chromeOverlayOpen, syncWebviewVisible]);

  const showFallback = !!loadError;
  const showLoading = loading && !loadError;
  const showHold =
    chromeOverlayOpen && webviewReady && !showLoading && !showFallback;

  return (
    <div className="pane-link-host" ref={hostRef}>
      {showLoading ? (
        <div className="pane-link-status" aria-busy="true">
          加载中…
        </div>
      ) : null}
      {showHold ? (
        <div className="pane-link-preview-hold" aria-hidden="true">
          <span className="pane-link-preview-hold-label">
            {linkPreviewHoldLabel(url)}
          </span>
        </div>
      ) : null}
      {showFallback ? (
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
