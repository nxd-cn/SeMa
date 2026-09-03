import { useCallback, useEffect, useRef } from "react";
import { marked } from "marked";
import { tui } from "../api/tui";
import { docSaveKeyAction, docSaveShortcutLabel } from "../lib/docSaveKeys";
import {
  clampDocFontSize,
  docFontSizeFromWheel,
} from "../lib/docFontZoom";
import { isMarkdownPath } from "../lib/panePreview";
import { useAppStore } from "../store/appStore";
import ChromeVScrollbar from "./ChromeVScrollbar";

export const DISCARD_UNSAVED_MESSAGE = "放弃未保存更改？";

export function confirmDiscardUnsaved(
  dirty: boolean,
  confirmFn: (message: string) => boolean,
): boolean {
  if (!dirty) return true;
  return confirmFn(DISCARD_UNSAVED_MESSAGE);
}

export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false });
  } catch {
    return "";
  }
}

type DocMode = "preview" | "edit";

type Props = {
  path: string;
  mode: DocMode;
  text: string;
  dirty: boolean;
  onMode: (mode: DocMode) => void;
  onText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
};

function ModeToggleIcon({ mode }: { mode: DocMode }) {
  if (mode === "preview") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12.15 2.15a1.5 1.5 0 0 1 2.12 2.12L6.5 12.04 3 13l.96-3.5 8.19-8.35ZM11 3.3 4.74 9.56l-.4 1.46 1.46-.4L12.06 4.36 11 3.3Z"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 3c3.2 0 5.9 2.1 7 5-1.1 2.9-3.8 5-7 5S2.1 10.9 1 8c1.1-2.9 3.8-5 7-5Zm0 1.5A3.5 3.5 0 1 0 8 11a3.5 3.5 0 0 0 0-6.5ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
      />
    </svg>
  );
}

/** Actions for the shared split header (mode toggle + dirty). */
export function PaneDocHeaderActions({
  path,
  mode,
  dirty,
  onMode,
}: {
  path: string;
  mode: DocMode;
  dirty: boolean;
  onMode: (mode: DocMode) => void;
}) {
  const markdown = isMarkdownPath(path);
  const saveLabel = docSaveShortcutLabel(tui.isMac);

  if (!markdown && !dirty) {
    return (
      <span className="pane-doc-save-hint" title={`保存：${saveLabel}`}>
        {saveLabel}
      </span>
    );
  }

  return (
    <>
      {markdown ? (
        <button
          type="button"
          className="pane-doc-mode-toggle"
          title={
            mode === "preview"
              ? "切换到编辑"
              : `切换到预览（未保存用 ${saveLabel}）`
          }
          aria-label={mode === "preview" ? "切换到编辑" : "切换到预览"}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onMode(mode === "preview" ? "edit" : "preview");
          }}
        >
          <ModeToggleIcon mode={mode} />
        </button>
      ) : (
        <span className="pane-doc-save-hint" title={`保存：${saveLabel}`}>
          {saveLabel}
        </span>
      )}
      {dirty ? (
        <span className="pane-doc-dirty-dot" title={`未保存 · ${saveLabel}`} />
      ) : null}
    </>
  );
}

export default function PaneDocView({
  path,
  mode,
  text,
  dirty,
  onMode: _onMode,
  onText,
  onSave,
  onClose: _onClose,
}: Props) {
  const markdown = isMarkdownPath(path);
  const showPreview = markdown && mode === "preview";
  const docFontSize = useAppStore((s) => s.docFontSize);
  const setDocFontSize = useAppStore((s) => s.setDocFontSize);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const layoutKey = `${path}:${mode}:${showPreview ? text.length : "edit"}`;
  const fontSizeRef = useRef(docFontSize);
  fontSizeRef.current = docFontSize;
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (!persistTimerRef.current) return;
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      void tui.setPrefs({ docFontSize: useAppStore.getState().docFontSize });
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const next = docFontSizeFromWheel(fontSizeRef.current, e, {
        isMac: tui.isMac,
      });
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      if (next === fontSizeRef.current) return;
      setDocFontSize(next);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void tui.setPrefs({ docFontSize: useAppStore.getState().docFontSize });
      }, 300);
    };
    // Capture + non-passive: Mac pinch (ctrlKey wheel) must run before WKWebView page zoom.
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () =>
      el.removeEventListener("wheel", onWheel, { capture: true });
  }, [setDocFontSize]);

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if (docSaveKeyAction(ev.nativeEvent, { isMac: tui.isMac }) !== "save") {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (dirty) onSave();
    },
    [dirty, onSave],
  );

  const fontStyle = { fontSize: `${docFontSize}px` };

  return (
    <div
      ref={rootRef}
      className="pane-doc-view"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-dirty={dirty ? "1" : "0"}
    >
      <div className="chrome-vscroll-shell">
        {showPreview ? (
          <div
            ref={(el) => {
              scrollRef.current = el;
            }}
            className="pane-doc-preview pane-doc-sandbox chrome-vscroll-port"
            style={fontStyle}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : (
          <textarea
            ref={(el) => {
              scrollRef.current = el;
            }}
            className="pane-doc-editor chrome-vscroll-port"
            style={fontStyle}
            value={text}
            spellCheck={false}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        <ChromeVScrollbar scrollRef={scrollRef} layoutKey={layoutKey} />
      </div>
    </div>
  );
}
