import { tui, type AuthStatus } from "../api/tui";

/** Dedupe concurrent / repeated status probes (each spawn is expensive). */
const cache = new Map<string, { at: number; status: AuthStatus }>();
const inflight = new Map<string, Promise<AuthStatus>>();
const TTL_MS = 60_000;

export function getCachedAuth(cliId: string): AuthStatus | null {
  const hit = cache.get(cliId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(cliId);
    return null;
  }
  return hit.status;
}

export function invalidateAuthCache(cliId?: string): void {
  if (cliId) cache.delete(cliId);
  else cache.clear();
}

export function fetchAuthStatus(cliId: string): Promise<AuthStatus> {
  const cached = getCachedAuth(cliId);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(cliId);
  if (pending) return pending;

  const p = tui
    .cliAuthStatus(cliId)
    .then((status) => {
      cache.set(cliId, { at: Date.now(), status });
      return status;
    })
    .finally(() => {
      inflight.delete(cliId);
    });
  inflight.set(cliId, p);
  return p;
}
