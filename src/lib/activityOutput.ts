/**
 * Strip OSC/CSI and other controls so busy-pulse ignores cursor/spinner redraws.
 */
export function stripTerminalControls(data: string): string {
  return String(data || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b./g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/**
 * True when PTY chunk looks like model/turn text (not empty ANSI-only redraw).
 * Streaming often arrives 1 char at a time — count any printable/newline.
 */
export function looksLikeTurnOutput(data: string): boolean {
  const text = stripTerminalControls(data);
  if (text.indexOf("\r") !== -1 || text.indexOf("\n") !== -1) return true;
  return text.trim().length >= 1;
}

/**
 * While already busy, any non-empty PTY chunk (including spinner ANSI) should
 * refresh the idle timer so mid-turn thinking does not drop the green pulse.
 */
export function shouldRefreshBusyTimer(
  busy: boolean,
  data: string,
  qualifying: boolean
): boolean {
  if (!busy) return qualifying;
  return String(data || "").length > 0;
}
