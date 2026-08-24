export function clipboardAction(
  ev: { type?: string; key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  opts: { hasSelection: boolean; isMac: boolean }
): "copy" | "paste" | null {
  if (!ev || ev.type !== "keydown") return null;
  const key = String(ev.key || "").toLowerCase();
  const hasSelection = !!opts.hasSelection;
  const isMac = !!opts.isMac;

  if (isMac) {
    if (!ev.metaKey) return null;
    if (key === "c") return hasSelection ? "copy" : null;
    if (key === "v") return "paste";
    return null;
  }

  if (!ev.ctrlKey) return null;
  if (key === "c") {
    if (ev.shiftKey || hasSelection) return "copy";
    return null;
  }
  if (key === "v") return "paste";
  return null;
}

export function selectionDeleteAction(
  ev: {
    type?: string;
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
  opts: { hasSelection: boolean }
): "deleteSelection" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (!opts.hasSelection) return null;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  const key = String(ev.key || "");
  if (key === "Backspace" || key === "Delete") return "deleteSelection";
  return null;
}

export function selectionDeletePayload(text: string): string {
  const n = Array.from(String(text ?? "")).length;
  return n > 0 ? "\x7f".repeat(n) : "";
}

export function lineClearAction(ev: {
  type?: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): "clearLine" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return null;
  if (String(ev.key || "").toLowerCase() === "u") return "clearLine";
  return null;
}

export const LINE_CLEAR_PAYLOAD = "\x15";

export function undoAction(
  ev: {
    type?: string;
    key?: string;
    code?: string;
    keyCode?: number;
    which?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  opts?: { isMac?: boolean }
): "undo" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (opts?.isMac) return null;
  if (ev.altKey || ev.shiftKey || ev.metaKey) return null;
  if (!ev.ctrlKey) return null;
  const key = String(ev.key || "").toLowerCase();
  const code = String(ev.code || "");
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (key === "z" || code === "KeyZ" || keyCode === 90) return "undo";
  return null;
}

export const UNDO_PAYLOAD = "\x1f";
