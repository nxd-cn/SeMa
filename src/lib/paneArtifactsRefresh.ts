import type { ArtifactsResult } from "../api/tui";
import { artifactsKey, shouldRefreshArtifacts } from "./artifactsRefresh";

export const ARTIFACTS_REFRESH_MIN_MS = 2000;

/** Loading chrome is only for a user-visible expanded force-refresh. */
export function shouldShowLoading(expanded: boolean, force: boolean): boolean {
  return expanded && force;
}

/** Stale in-flight generations must not call setLoading / setArtifacts. */
export function isCurrentArtifactsRequest(
  requestId: number,
  latestId: number,
): boolean {
  return requestId === latestId;
}

export type ArtifactsQuery = {
  cliId: string;
  cwd: string;
  cliSessionId?: string | null;
};

export type ArtifactsRefreshOutcome =
  | { kind: "unbound" }
  | { kind: "throttled" }
  | { kind: "stale"; lastFetchMs: number }
  | { kind: "ok"; result: ArtifactsResult; lastFetchMs: number };

/** Current gen must clear loading on ok/unbound/stale so stale cannot stick true. */
export function shouldClearArtifactsLoading(
  requestIsCurrent: boolean,
  kind: ArtifactsRefreshOutcome["kind"],
): boolean {
  return requestIsCurrent && (kind === "ok" || kind === "unbound" || kind === "stale");
}

export async function runArtifactsRefresh(opts: {
  query: ArtifactsQuery;
  force: boolean;
  lastFetchMs: number;
  nowMs: number;
  minIntervalMs?: number;
  sessionArtifacts: (args: ArtifactsQuery) => Promise<ArtifactsResult>;
  currentBoundId: () => string | null | undefined;
}): Promise<ArtifactsRefreshOutcome> {
  const id = artifactsKey(opts.query.cliSessionId);
  if (!id) return { kind: "unbound" };

  const min = opts.minIntervalMs ?? ARTIFACTS_REFRESH_MIN_MS;
  if (!opts.force && !shouldRefreshArtifacts(opts.lastFetchMs, opts.nowMs, min)) {
    return { kind: "throttled" };
  }

  const result = await opts.sessionArtifacts({
    cliId: opts.query.cliId,
    cwd: opts.query.cwd,
    cliSessionId: id,
  });

  if (artifactsKey(opts.currentBoundId()) !== id) {
    return { kind: "stale", lastFetchMs: opts.nowMs };
  }
  return { kind: "ok", result, lastFetchMs: opts.nowMs };
}
