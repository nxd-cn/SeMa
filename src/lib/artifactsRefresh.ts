export function shouldRefreshArtifacts(
  lastFetchMs: number,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  return nowMs - lastFetchMs >= minIntervalMs;
}

export function artifactsKey(cliSessionId: string | null | undefined): string {
  return cliSessionId ? String(cliSessionId) : "";
}
