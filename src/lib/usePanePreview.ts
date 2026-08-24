import { useCallback, useEffect, useRef, useState } from "react";
import { tui } from "../api/tui";
import { confirmDiscardUnsaved } from "../components/PaneDocView";
import { useAppStore } from "../store/appStore";
import {
  openDocPreview,
  openLinkPreview,
  type PanePreview,
} from "./panePreview";

export function isDocDirty(preview: PanePreview): boolean {
  return preview?.kind === "doc" && preview.dirty;
}

export function shouldForceClosePreview(
  cliSessionId: string | null | undefined,
): boolean {
  return !cliSessionId;
}

export function previewErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

type ConfirmOpts = {
  force?: boolean;
  confirm: (message: string) => boolean;
};

export function canReplacePreview(
  preview: PanePreview,
  opts: ConfirmOpts,
): boolean {
  if (opts.force) return true;
  return confirmDiscardUnsaved(isDocDirty(preview), opts.confirm);
}

export function closePreview(
  preview: PanePreview,
  opts: ConfirmOpts,
): PanePreview {
  if (!canReplacePreview(preview, opts)) return preview;
  return null;
}

export function openDocErrorPreview(
  prev: PanePreview,
  path: string,
  error: string,
): PanePreview {
  const opened = openDocPreview(prev, path, "");
  if (opened === null || opened.kind !== "doc") return opened;
  return { ...opened, error };
}

export function applyDocText(preview: PanePreview, text: string): PanePreview {
  if (preview?.kind !== "doc") return preview;
  return { ...preview, text, dirty: true, error: undefined };
}

export function applyDocMode(
  preview: PanePreview,
  mode: "preview" | "edit",
): PanePreview {
  if (preview?.kind !== "doc") return preview;
  return { ...preview, mode };
}

export function applySplitRatio(
  preview: PanePreview,
  splitRatio: number,
): PanePreview {
  if (preview === null) return preview;
  return { ...preview, splitRatio };
}

export function applyDocSaved(preview: PanePreview): PanePreview {
  if (preview?.kind !== "doc") return preview;
  return { ...preview, dirty: false, error: undefined };
}

export function applyDocSaveError(
  preview: PanePreview,
  error: string,
): PanePreview {
  if (preview?.kind !== "doc") return preview;
  return { ...preview, error };
}

export function applyLinkLoadError(preview: PanePreview): PanePreview {
  if (preview?.kind !== "link") return preview;
  return { ...preview, loadError: true };
}

export function paneWebviewVisibleArgs(
  paneId: string,
  visible: boolean,
  preview: PanePreview,
): { id: string; visible: boolean } | null {
  if (preview?.kind !== "link" || preview.loadError) return null;
  return { id: paneId, visible };
}

export function shouldClosePaneWebviewOnChange(
  prev: PanePreview,
  next: PanePreview,
): boolean {
  return prev?.kind === "link" && next?.kind !== "link";
}

function closePaneWebview(paneId: string) {
  void tui.paneWebviewClose(paneId).catch(() => {});
}

function nativeConfirm(message: string): boolean {
  return window.confirm(message);
}

export function usePanePreview(paneId: string, visible = true) {
  const [preview, setPreview] = useState<PanePreview>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const genRef = useRef(0);

  const cliSessionId = useAppStore((s) => s.panes[paneId]?.cliSessionId);

  const bound = useCallback(() => {
    return Boolean(useAppStore.getState().panes[paneId]?.cliSessionId);
  }, [paneId]);

  useEffect(() => {
    if (!shouldForceClosePreview(cliSessionId)) return;
    genRef.current += 1;
    if (shouldClosePaneWebviewOnChange(previewRef.current, null)) {
      closePaneWebview(paneId);
    }
    setPreview(null);
  }, [cliSessionId, paneId]);

  const openDoc = useCallback(
    async (path: string) => {
      if (!bound()) return;
      if (
        !canReplacePreview(previewRef.current, { confirm: nativeConfirm })
      ) {
        return;
      }
      const gen = ++genRef.current;
      const prev = previewRef.current;
      try {
        const text = await tui.readTextFile({ path });
        if (gen !== genRef.current) return;
        const next = openDocPreview(previewRef.current, path, text);
        if (shouldClosePaneWebviewOnChange(prev, next)) closePaneWebview(paneId);
        setPreview(next);
      } catch (err) {
        if (gen !== genRef.current) return;
        const next = openDocErrorPreview(
          previewRef.current,
          path,
          previewErrorMessage(err),
        );
        if (shouldClosePaneWebviewOnChange(prev, next)) closePaneWebview(paneId);
        setPreview(next);
      }
    },
    [bound, paneId],
  );

  const openLink = useCallback(
    (url: string) => {
      if (!bound()) return;
      if (
        !canReplacePreview(previewRef.current, { confirm: nativeConfirm })
      ) {
        return;
      }
      genRef.current += 1;
      setPreview(openLinkPreview(previewRef.current, url));
    },
    [bound],
  );

  const close = useCallback(
    (force = false) => {
      if (force) {
        const prev = previewRef.current;
        genRef.current += 1;
        if (shouldClosePaneWebviewOnChange(prev, null)) closePaneWebview(paneId);
        setPreview(null);
        return;
      }
      setPreview((prev) => {
        const next = closePreview(prev, { confirm: nativeConfirm });
        if (shouldClosePaneWebviewOnChange(prev, next)) closePaneWebview(paneId);
        if (next === null && prev !== null) genRef.current += 1;
        return next;
      });
    },
    [paneId],
  );

  const setRatio = useCallback((ratio: number) => {
    setPreview((prev) => applySplitRatio(prev, ratio));
  }, []);

  const setMode = useCallback((mode: "preview" | "edit") => {
    setPreview((prev) => applyDocMode(prev, mode));
  }, []);

  const setText = useCallback((text: string) => {
    setPreview((prev) => applyDocText(prev, text));
  }, []);

  const saveDoc = useCallback(async () => {
    const cur = previewRef.current;
    if (cur?.kind !== "doc" || !cur.dirty) return;
    const path = cur.path;
    const text = cur.text;
    try {
      await tui.writeTextFile({ path, contents: text });
      const now = previewRef.current;
      if (now?.kind === "doc" && now.path === path && now.text === text) {
        setPreview(applyDocSaved(now));
      }
    } catch (err) {
      const now = previewRef.current;
      if (now?.kind === "doc" && now.path === path) {
        setPreview(applyDocSaveError(now, previewErrorMessage(err)));
      }
    }
  }, []);

  const setVisible = useCallback(
    (nextVisible: boolean) => {
      const args = paneWebviewVisibleArgs(paneId, nextVisible, previewRef.current);
      if (args) {
        void tui.paneWebviewSetVisible(args).catch(() => {});
      }
    },
    [paneId],
  );

  useEffect(() => {
    setVisible(visible);
  }, [visible, setVisible]);

  const markLinkLoadError = useCallback(() => {
    setPreview((prev) => applyLinkLoadError(prev));
  }, []);

  return {
    preview,
    openDoc,
    openLink,
    close,
    setRatio,
    setMode,
    setText,
    saveDoc,
    setVisible,
    markLinkLoadError,
  };
}
