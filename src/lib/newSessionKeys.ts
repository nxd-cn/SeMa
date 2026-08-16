/**
 * In-app accelerator for "新建会话".
 * Only delivered while SeMa's window is focused (not a global OS hotkey).
 *
 * Mac: ⌘⇧N  Win: Ctrl+Shift+N
 * Avoids bare Ctrl+N (readline next-history in the PTY on Windows).
 */
export function newSessionKeyAction(
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
): "newSession" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (ev.altKey) return null;
  if (!ev.shiftKey) return null;

  const key = String(ev.key || "").toLowerCase();
  const isN = key === "n" || ev.code === "KeyN";
  if (!isN) return null;

  if (opts.isMac) {
    // Cmd+Shift+N — do not require ctrl; ignore accidental ctrl.
    if (!ev.metaKey) return null;
    return "newSession";
  }

  // Windows: Ctrl+Shift+N (metaKey is usually false)
  if (!ev.ctrlKey || ev.metaKey) return null;
  return "newSession";
}

export function newSessionShortcutLabel(isMac: boolean): string {
  return isMac ? "⌘⇧N" : "Ctrl+Shift+N";
}
