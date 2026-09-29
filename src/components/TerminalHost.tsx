import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { tui } from "../api/tui";
import { termFontSizeFromWheel } from "../lib/docFontZoom";
import { attachImeHeuristic } from "../lib/imeAnchor";
import { attachInkHardwareCursorLock } from "../lib/lockInkHardwareCursor";
import {
  canFitInHost,
  clampRowsToClientHeight,
  MIN_FIT_COLS,
  MIN_FIT_ROWS,
  proposeFitDimensions,
} from "../lib/termFitSafe";
import {
  captureTermScroll,
  type TermScrollSnapshot,
  restoreTermScroll,
  termOwnsFocus,
} from "../lib/termScroll";
import { attachCapsLockImeFix } from "../lib/xtermCapsLockIme";
import { useAppStore } from "../store/appStore";

export type TermHandle = {
  term: Terminal;
  focus: () => void;
  /** Clear scrollback + screen before ↻ so old TUI chrome does not linger. */
  resetClear: () => void;
  /** Fit xterm to host and push cols/rows to the PTY. */
  refit: () => void;
  cols: () => number;
  rows: () => number;
  getSelection: () => string;
  clearSelection: () => void;
  hasSelection: () => boolean;
  selectAll: () => void;
};

type Props = {
  sessionId: string;
  /** System Terminal needs a visible caret; Ink AI CLIs hide the hardware one. */
  cliId: string;
  visible: boolean;
  onSubmitChat: () => void;
  /** Non-submit PTY write (typing / paste) — parent may disarm activity pulse. */
  onUserComposing?: () => void;
  onActivityData: (data: string) => void;
  /** User submitted /clear|/new|/reset — drop bound CLI session id. */
  onCliSessionCleared?: () => void;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    hasSelection: boolean
  ) => void;
  onExit?: () => void;
  onTermReady?: (handle: TermHandle | null) => void;
};

type CoreDims = {
  _core?: {
    _renderService?: {
      dimensions?: { css?: { cell?: { width?: number; height?: number } } };
    };
    viewport?: { syncScrollArea?: (force?: boolean) => void };
  };
};

function focusTerm(term: Terminal) {
  try {
    term.focus();
  } catch {
    /* ignore */
  }
}

export default function TerminalHost({
  sessionId,
  cliId,
  visible,
  onSubmitChat,
  onUserComposing,
  onActivityData,
  onCliSessionCleared,
  onContextMenu,
  onExit,
  onTermReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termLocal = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const fitPaneRef = useRef<(opts?: { force?: boolean }) => void>(() => {});
  const visibleRef = useRef(visible);
  const clearBufRef = useRef("");
  const termFontSize = useAppStore((s) => s.termFontSize);
  const setTermFontSize = useAppStore((s) => s.setTermFontSize);
  const termFontSizeRef = useRef(termFontSize);
  termFontSizeRef.current = termFontSize;
  const persistFontTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSnapRef = useRef<TermScrollSnapshot | null>(null);
  const lastHostSizeRef = useRef<{ w: number; h: number } | null>(null);
  const fitRafRef = useRef<number>(0);
  const callbacks = useRef({
    onSubmitChat,
    onUserComposing,
    onActivityData,
    onCliSessionCleared,
    onExit,
    onTermReady,
  });
  callbacks.current = {
    onSubmitChat,
    onUserComposing,
    onActivityData,
    onCliSessionCleared,
    onExit,
    onTermReady,
  };
  visibleRef.current = visible;

  const fitPane = (opts?: { force?: boolean }) => {
    const term = termLocal.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    if (!opts?.force && !visibleRef.current) return;
    const hostW = host.clientWidth | 0;
    const hostH = host.clientHeight | 0;
    const prevSize = lastHostSizeRef.current;
    // Switching tabs often re-triggers observers without real size changes.
    // Skip redundant fit cycles to avoid black flicker/repaint jumps.
    if (
      !opts?.force &&
      prevSize &&
      prevSize.w === hostW &&
      prevSize.h === hostH
    ) {
      if (scrollSnapRef.current) restoreTermScroll(term, scrollSnapRef.current);
      return;
    }
    lastHostSizeRef.current = { w: hostW, h: hostH };

    // Sibling split (top-right CLI) shrinks this host; layout can zero
    // scrollTop and xterm then jumps ydisp to the top of scrollback.
    const scrollSnap =
      scrollSnapRef.current ?? captureTermScroll(term.buffer.active);

    const core = term as unknown as CoreDims;
    const dims = core._core?._renderService?.dimensions;
    const cellW = dims?.css?.cell?.width ?? 0;
    const cellH = dims?.css?.cell?.height ?? 0;

    if (cellW > 0 && cellH > 0) {
      if (!canFitInHost(host.clientWidth, host.clientHeight, cellW, cellH)) {
        return;
      }
    } else if (hostW < 160 || hostH < 80) {
      return;
    }

    fit.fit();
    let cols = term.cols | 0;
    let rows = term.rows | 0;

    if (cellW > 0 && cellH > 0) {
      const proposed = proposeFitDimensions(
        hostW,
        hostH,
        cellW,
        cellH,
        { scrollbarWidth: 0 }
      );
      if (proposed) {
        cols = proposed.cols;
        rows = clampRowsToClientHeight(
          proposed.rows,
          cellH,
          hostH
        );
      } else {
        rows = clampRowsToClientHeight(rows, cellH, hostH);
      }
      if (term.cols !== cols || term.rows !== rows) {
        term.resize(cols, rows);
      }
    }

    try {
      core._core?.viewport?.syncScrollArea?.(true);
    } catch {
      /* ignore */
    }

    restoreTermScroll(term, scrollSnap);
    scrollSnapRef.current = captureTermScroll(term.buffer.active);

    if (cols < MIN_FIT_COLS || rows < MIN_FIT_ROWS) return;
    void tui.resize(sessionId, cols, rows);
  };

  fitPaneRef.current = fitPane;

  const scheduleFit = (opts?: { force?: boolean }) => {
    if (fitRafRef.current) return;
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = 0;
      fitPane(opts);
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Cursor / Claude / Ink TUIs draw their own caret (inverse cell). They often
    // park the hardware cursor on the same cell (or the row under the input).
    // A bg-colored *block* cursor uses !important fill and erases that inverse
    // cell — caret vanishes while typing still works. Use bar + bg-matched
    // cursor color: no cell fill, and the 1px bar is invisible on the dark bg.
    // System Terminal has no Ink caret — show a normal blinking block instead.
    const bg = "#0c0c0c";
    const fg = "#cccccc";
    const isSystemTerminal = cliId === "terminal";
    // Claude can sit in non-Ink states where the inverse caret is absent.
    // Keep bar cursor (no cell fill) but make it visible for Claude only.
    const needsVisibleBarCursor = cliId === "claude";
    const needsBlinkingBarCursor = cliId === "claude";
    const term = new Terminal({
      cursorBlink: isSystemTerminal || needsBlinkingBarCursor,
      cursorStyle: isSystemTerminal ? "block" : "bar",
      cursorWidth: 1,
      cursorInactiveStyle: isSystemTerminal ? "block" : "outline",
      fontFamily:
        'Menlo, Monaco, Cascadia Mono, Consolas, "Courier New", monospace',
      fontSize: termFontSizeRef.current,
      theme: {
        background: bg,
        foreground: fg,
        cursor: isSystemTerminal || needsVisibleBarCursor ? fg : bg,
        cursorAccent: bg,
        selectionBackground: "#264f78",
        selectionInactiveBackground: "#264f78",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termLocal.current = term;
    fitRef.current = fit;

    // Ink AI CLIs park hardware cursor at row end; pin IME to inverse caret
    // (otherwise Windows candidate window sits at the far right).
    const ime = attachImeHeuristic(term);
    // CLIs may DECSCUSR → block and erase the Ink caret; keep bar locked.
    const inkCursorLock = isSystemTerminal
      ? null
      : attachInkHardwareCursorLock(term, {
          blink: needsBlinkingBarCursor,
        });
    // Mac only: CapsLock 中/英 during composition double-sends on WKWebView.
    const capsLockIme = tui.isMac ? attachCapsLockImeFix(term) : null;

    const handle: TermHandle = {
      term,
      focus: () => focusTerm(term),
      resetClear: () => {
        try {
          term.reset();
          term.clear();
          term.write("\x1b[0m\x1b[2J\x1b[H");
          term.scrollToBottom();
          scrollSnapRef.current = captureTermScroll(term.buffer.active);
        } catch {
          /* ignore */
        }
      },
      refit: () => fitPane({ force: true }),
      cols: () => term.cols | 0,
      rows: () => term.rows | 0,
      getSelection: () => term.getSelection(),
      clearSelection: () => term.clearSelection(),
      hasSelection: () => term.hasSelection(),
      selectAll: () => term.selectAll(),
    };
    callbacks.current.onTermReady?.(handle);

    if (term.textarea) {
      term.textarea.setAttribute("lang", "zh-CN");
    }

    const writeToSession = (data: string) => {
      if (capsLockIme) {
        const filtered = capsLockIme.filterData(data);
        if (filtered === null) return;
        data = filtered;
      }
      clearBufRef.current = tui.pushCliClearBuffer(clearBufRef.current, data);
      if (tui.looksLikeCliClearSubmit(clearBufRef.current)) {
        clearBufRef.current = "";
        callbacks.current.onCliSessionCleared?.();
      }
      if (tui.dataLooksLikeSubmit(data)) {
        callbacks.current.onSubmitChat();
      } else if (data.length > 0) {
        callbacks.current.onUserComposing?.();
      }
      void tui.write(sessionId, data);
    };

    const deleteSelection = () => {
      const payload = tui.selectionDeletePayload(term.getSelection());
      term.clearSelection();
      if (payload) void tui.write(sessionId, payload);
    };

    const dataDisp = term.onData((data) => writeToSession(data));
    const scrollDisp = term.onScroll(() => {
      scrollSnapRef.current = captureTermScroll(term.buffer.active);
    });

    term.attachCustomKeyEventHandler((ev) => {
      if (
        tui.chatSubmitKeyAction({
          type: ev.type,
          key: ev.key,
          code: ev.code,
          keyCode: ev.keyCode,
          which: ev.which,
          isComposing: ev.isComposing,
        }) === "submit"
      ) {
        callbacks.current.onSubmitChat();
      }

      if (
        tui.shouldSuppressForImeComposition({
          type: ev.type,
          key: ev.key,
          code: ev.code,
          keyCode: ev.keyCode,
          which: ev.which,
        })
      ) {
        return false;
      }

      if (
        tui.selectionDeleteAction(ev, term.hasSelection()) ===
        "deleteSelection"
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        deleteSelection();
        return false;
      }

      if (tui.lineClearAction(ev) === "clearLine") {
        ev.preventDefault();
        ev.stopPropagation();
        term.clearSelection();
        void tui.write(sessionId, tui.LINE_CLEAR_PAYLOAD);
        return false;
      }

      if (tui.undoAction(ev) === "undo") {
        ev.preventDefault();
        ev.stopPropagation();
        void tui.write(sessionId, tui.UNDO_PAYLOAD);
        return false;
      }

      const action = tui.clipboardAction(ev, term.hasSelection());
      if (action === "copy") {
        ev.preventDefault();
        ev.stopPropagation();
        void tui.clipboardWrite(term.getSelection());
        return false;
      }
      // WebView paste events often have empty clipboardData — handle on keydown
      // via Tauri/system clipboard APIs (text + image).
      if (action === "paste") {
        ev.preventDefault();
        ev.stopPropagation();
        void runPaste("key");
        return false;
      }
      return true;
    });

    const insertDroppedImages = async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const path = await tui.saveImageFile(file);
        if (!path) continue;
        const attach = tui.formatImageAttach(path, cliId);
        if (attach) writeToSession(attach);
      }
    };

    // Dedupe keydown + paste event (some WebViews fire both).
    let pasteBusy = false;
    const runPaste = async (source: "key" | "event", e?: ClipboardEvent) => {
      if (pasteBusy) return;
      pasteBusy = true;
      try {
        const text =
          source === "event" && e
            ? await tui.pasteFromClipboardEvent(e, cliId)
            : await tui.clipboardReadForPaste(cliId);
        if (text) writeToSession(text);
      } finally {
        window.setTimeout(() => {
          pasteBusy = false;
        }, 200);
      }
    };

    // Backup when the browser delivers clipboardData (and key path missed it).
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void runPaste("event", e);
    };
    term.textarea?.addEventListener("paste", onPaste, true);
    host.addEventListener("paste", onPaste, true);

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      void insertDroppedImages(files);
      focusTerm(term);
    };
    host.addEventListener("dragenter", onDragEnter);
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);

    const unData = tui.onData(({ id, data }) => {
      if (id !== sessionId) return;
      term.write(data);
      callbacks.current.onActivityData(data);
    });

    const unExit = tui.onExit(({ id }) => {
      if (id !== sessionId) return;
      callbacks.current.onExit?.();
    });

    let fitRoRaf = 0;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (fitRoRaf) cancelAnimationFrame(fitRoRaf);
            fitRoRaf = requestAnimationFrame(() => {
              fitRoRaf = 0;
              if (!visibleRef.current) return;
              const keepFocus = termOwnsFocus(
                term.textarea,
                document.activeElement
              );
              scheduleFit();
              // Sibling pane resize must not steal focus from the new CLI.
              if (keepFocus) focusTerm(term);
            });
          })
        : null;
    ro?.observe(host);

    // Layout settle: keep one immediate + one delayed pass only.
    const fitTimers = [0, 180].map((ms) =>
      window.setTimeout(() => {
        if (!visibleRef.current) return;
        const keepFocus = termOwnsFocus(term.textarea, document.activeElement);
        scheduleFit();
        if (keepFocus || ms === 0) focusTerm(term);
      }, ms)
    );

    return () => {
      for (const t of fitTimers) window.clearTimeout(t);
      unData();
      unExit();
      dataDisp.dispose();
      scrollDisp.dispose();
      term.textarea?.removeEventListener("paste", onPaste, true);
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("dragenter", onDragEnter);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      ro?.disconnect();
      if (fitRoRaf) cancelAnimationFrame(fitRoRaf);
      if (fitRafRef.current) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = 0;
      }
      try {
        capsLockIme?.detach();
      } catch {
        /* ignore */
      }
      try {
        inkCursorLock?.detach();
      } catch {
        /* ignore */
      }
      try {
        ime.detach();
      } catch {
        /* ignore */
      }
      try {
        term.dispose();
      } catch {
        /* ignore */
      }
      termLocal.current = null;
      fitRef.current = null;
      callbacks.current.onTermReady?.(null);
    };
    // sessionId is stable per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const term = termLocal.current;
    if (!term || term.options.fontSize === termFontSize) return;
    term.options.fontSize = termFontSize;
    scheduleFit({ force: true });
  }, [termFontSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      const next = termFontSizeFromWheel(termFontSizeRef.current, e, {
        isMac: tui.isMac,
      });
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      if (next === termFontSizeRef.current) return;
      setTermFontSize(next);
      if (persistFontTimerRef.current) {
        clearTimeout(persistFontTimerRef.current);
      }
      persistFontTimerRef.current = setTimeout(() => {
        persistFontTimerRef.current = null;
        void tui.setPrefs({ termFontSize: useAppStore.getState().termFontSize });
      }, 300);
    };
    host.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      host.removeEventListener("wheel", onWheel, { capture: true });
      if (persistFontTimerRef.current) {
        clearTimeout(persistFontTimerRef.current);
        persistFontTimerRef.current = null;
        void tui.setPrefs({ termFontSize: useAppStore.getState().termFontSize });
      }
    };
  }, [setTermFontSize]);

  useEffect(() => {
    const term = termLocal.current;
    if (!term) return;
    if (!visible) {
      // Keep last known good anchor before pane is parked.
      scrollSnapRef.current = captureTermScroll(term.buffer.active);
      return;
    }
    requestAnimationFrame(() => {
      // Restore first for smooth visual continuity; fit only if host size changed.
      const t = termLocal.current;
      if (t) {
        if (scrollSnapRef.current) restoreTermScroll(t, scrollSnapRef.current);
        focusTerm(t);
      }
      scheduleFit();
    });
  }, [visible]);

  useEffect(() => {
    const onResize = () => {
      if (!visibleRef.current) return;
      scheduleFit();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sessionId]);

  return (
    <div
      className="pane-term-host"
      ref={hostRef}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        const term = termLocal.current;
        onContextMenu(e.clientX, e.clientY, !!term?.hasSelection());
      }}
    />
  );
}
