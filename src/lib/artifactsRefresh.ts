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

export type ArtifactsCollectPane = {
  cliSessionId?: string | null;
  artifactsIncludeHistory?: boolean;
  artifactsSinceSeq?: number | null;
  /** Layout/canResume offer pending — wait for ↻ before collecting. */
  resumeOfferPending?: boolean;
};

/** Resume (↻): full session history. New chat: seq baseline after discover. */
export function artifactsCollectReady(pane: ArtifactsCollectPane): boolean {
  if (!artifactsKey(pane.cliSessionId)) return false;
  if (pane.resumeOfferPending) return false;
  if (pane.artifactsIncludeHistory) return true;
  return typeof pane.artifactsSinceSeq === "number";
}

export function artifactsScopeKey(pane: ArtifactsCollectPane): string {
  const id = artifactsKey(pane.cliSessionId);
  if (!id) return "";
  if (pane.artifactsIncludeHistory) return `${id}:full`;
  if (typeof pane.artifactsSinceSeq === "number") {
    return `${id}:${pane.artifactsSinceSeq}`;
  }
  return `${id}:pending`;
}

/** @deprecated use artifactsCollectReady */
export function artifactsBaselineReady(
  sinceSeq: number | null | undefined,
): sinceSeq is number {
  return typeof sinceSeq === "number";
}
