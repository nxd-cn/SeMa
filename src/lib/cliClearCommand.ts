/** Track PTY input for CLI session-reset slash commands (`/clear`, `/new`, `/reset`). */

const CLEAR_RE = /\/(?:clear|new|reset)\s*[\r\n]/i;

export function pushCliClearBuffer(prev: string, chunk: string, max = 48): string {
  const next = `${prev}${chunk}`;
  return next.length > max ? next.slice(-max) : next;
}

export function looksLikeCliClearSubmit(buf: string): boolean {
  return CLEAR_RE.test(String(buf || ""));
}
