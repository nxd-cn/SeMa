/** Trimmed title, or null to clear customTitle (restore default folder name). */
export function commitCustomTitle(raw: string): string | null {
  const t = String(raw ?? "").trim();
  return t ? t : null;
}
