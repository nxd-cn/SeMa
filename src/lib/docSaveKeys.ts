/**
 * Document save shortcut (pane doc editor).
 * Mac: ⌘S  Win: Ctrl+S
 */
export function docSaveKeyAction(
  ev: {
    type?: string;
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  opts: { isMac: boolean }
): "save" | null {
  if (ev.type !== "keydown") return null;
  const key = (ev.key || "").toLowerCase();
  if (key !== "s") return null;
  if (ev.altKey || ev.shiftKey) return null;
  if (opts.isMac) {
    if (!ev.metaKey || ev.ctrlKey) return null;
    return "save";
  }
  if (!ev.ctrlKey || ev.metaKey) return null;
  return "save";
}

export function docSaveShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘S" : "Ctrl+S";
}
