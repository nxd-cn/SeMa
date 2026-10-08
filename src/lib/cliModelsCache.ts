import { tui, type ModelInfo } from "../api/tui";

/** Dedupe / cache model list probes (CLI spawn can be multi-second). */
const cache = new Map<string, { at: number; models: ModelInfo[] }>();
const inflight = new Map<string, Promise<ModelInfo[]>>();

const TTL_MS = 10 * 60 * 1000;

export function getCachedModels(cliId: string): ModelInfo[] | null {
  const hit = cache.get(cliId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(cliId);
    return null;
  }
  return hit.models;
}

export function invalidateModelsCache(cliId?: string): void {
  if (cliId) {
    cache.delete(cliId);
    inflight.delete(cliId);
  } else {
    cache.clear();
    inflight.clear();
  }
}

export function fetchModelsList(
  cliId: string,
  opts?: { force?: boolean }
): Promise<ModelInfo[]> {
  if (!opts?.force) {
    const hit = getCachedModels(cliId);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(cliId);
    if (pending) return pending;
  }

  const p = tui
    .cliModelsList(cliId)
    .then((r) => {
      const models = r.models || [];
      cache.set(cliId, { at: Date.now(), models });
      return models;
    })
    .catch(() => {
      const models: ModelInfo[] = [];
      cache.set(cliId, { at: Date.now(), models });
      return models;
    })
    .finally(() => {
      inflight.delete(cliId);
    });

  inflight.set(cliId, p);
  return p;
}
