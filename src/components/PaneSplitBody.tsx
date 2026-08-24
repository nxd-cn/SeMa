import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SPLIT_RATIO, type PanePreview } from "../lib/panePreview";

export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function splitRatioFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number
): number {
  if (!(containerWidth > 0)) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((clientX - containerLeft) / containerWidth);
}

export function previewHeaderTitle(
  preview: Exclude<PanePreview, null>
): string {
  if (preview.kind === "link") return preview.url;
  const base = preview.path.replace(/\\/g, "/").split("/").pop();
  return base && base.length > 0 ? base : preview.path;
}

type Props = {
  splitRatio: number;
  onSplitRatio: (ratio: number) => void;
  preview: PanePreview;
  onClosePreview: () => void;
  /** Extra controls before × (e.g. doc mode toggle + dirty dot). */
  headerActions?: ReactNode;
  terminal: ReactNode;
  content: ReactNode | null;
};

export default function PaneSplitBody({
  splitRatio,
  onSplitRatio,
  preview,
  onClosePreview,
  headerActions,
  terminal,
  content,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onSplitRatio(splitRatioFromPointer(e.clientX, rect.left, rect.width));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onSplitRatio]);

  if (preview == null) {
    return terminal;
  }

  const leftFlex = clampSplitRatio(splitRatio);
  const rightFlex = 1 - leftFlex;
  const title = previewHeaderTitle(preview);

  return (
    <div
      ref={bodyRef}
      className={`pane-split-body${dragging ? " is-dragging" : ""}`}
    >
      <div className="pane-split-term" style={{ flex: `${leftFlex} 1 0` }}>
        {terminal}
      </div>
      <div
        className={`col-resizer pane-split-splitter${dragging ? " dragging" : ""}`}
        title="拖动调整预览宽度"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
      />
      <div className="pane-split-content" style={{ flex: `${rightFlex} 1 0` }}>
        <div className="pane-split-header">
          <span className="pane-split-title" title={title}>
            {title}
          </span>
          <div className="pane-split-header-actions">
            {headerActions}
            <button
              type="button"
              className="pane-split-close"
              title="关闭预览"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onClosePreview();
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div className="pane-split-content-body">{content}</div>
      </div>
    </div>
  );
}
