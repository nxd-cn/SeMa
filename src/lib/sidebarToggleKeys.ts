/**
 * In-app accelerator for sidebar collapse/expand.
 * Only while SeMa's window is focused (not a global OS hotkey).
 *
 * Mac: ⌘⇧B  Win: Ctrl+Shift+B
 * Avoids bare Ctrl+B (readline backward-char in the PTY on Windows).
 */
export function sidebarToggleKeyAction(
  ev: {
    type?: string;
    key?: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  opts: { isMac: boolean }
): "toggleSidebar" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (ev.altKey) return null;
  if (!ev.shiftKey) return null;

  const key = String(ev.key || "").toLowerCase();
  const isB = key === "b" || ev.code === "KeyB";
  if (!isB) return null;

  if (opts.isMac) {
    if (!ev.metaKey) return null;
    return "toggleSidebar";
  }

  if (!ev.ctrlKey || ev.metaKey) return null;
  return "toggleSidebar";
}

export function sidebarToggleShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘⇧B" : "Ctrl+Shift+B";
}
