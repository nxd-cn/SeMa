import { useCallback, useEffect, useRef, useState } from "react";
import { tui, type ArtifactsResult } from "../api/tui";
import { useAppStore } from "../store/appStore";
import type { PaneState } from "../store/types";
import { artifactsKey, shouldRefreshArtifacts } from "./artifactsRefresh";
import {
  ARTIFACTS_REFRESH_MIN_MS,
  isCurrentArtifactsRequest,
  runArtifactsRefresh,
  shouldClearArtifactsLoading,
  shouldShowLoading,
} from "./paneArtifactsRefresh";

const EMPTY: ArtifactsResult = { docs: [], links: [] };

export function usePaneArtifacts(pane: PaneState, visible: boolean) {
  const [artifacts, setArtifacts] = useState<ArtifactsResult>(EMPTY);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastFetch = useRef(0);
  const fetchGenRef = useRef(0);
  const expandedRef = useRef(false);
  const boundKeyRef = useRef(artifactsKey(pane.cliSessionId));
  const paneRef = useRef(pane);
  paneRef.current = pane;

  const refresh = useCallback(async (force: boolean) => {
    const p = paneRef.current;
    const requested = artifactsKey(p.cliSessionId);
    if (!requested) {
      fetchGenRef.current += 1;
      setArtifacts(EMPTY);
      setLoading(false);
      return;
    }
    const nowMs = Date.now();
    if (
      !force &&
      !shouldRefreshArtifacts(lastFetch.current, nowMs, ARTIFACTS_REFRESH_MIN_MS)
    ) {
      return;
    }
    lastFetch.current = nowMs;
    const gen = ++fetchGenRef.current;
    if (shouldShowLoading(expandedRef.current, force)) setLoading(true);
    const outcome = await runArtifactsRefresh({
      query: {
        cliId: p.cliId,
        cwd: p.cwd,
        cliSessionId: requested,
      },
      force: true,
      lastFetchMs: nowMs,
      nowMs,
      sessionArtifacts: (args) => tui.sessionArtifacts(args),
      currentBoundId: () =>
        useAppStore.getState().panes[p.id]?.cliSessionId,
    });
    const isCurrent = isCurrentArtifactsRequest(gen, fetchGenRef.current);
    if (shouldClearArtifactsLoading(isCurrent, outcome.kind)) {
      setLoading(false);
    }
    if (!isCurrent) return;
    if (outcome.kind === "stale") return;
    if (outcome.kind === "unbound") {
      setArtifacts(EMPTY);
      return;
    }
    if (outcome.kind === "ok") {
      setArtifacts(outcome.result);
    }
  }, []);

  useEffect(() => {
    const key = artifactsKey(pane.cliSessionId);
    const idChanged = key !== boundKeyRef.current;
    if (idChanged) {
      fetchGenRef.current += 1;
      boundKeyRef.current = key;
      setArtifacts(EMPTY);
      lastFetch.current = 0;
    }
    if (!key) {
      fetchGenRef.current += 1;
      setLoading(false);
      return;
    }
    if (idChanged || visible) {
      void refresh(true);
    }
  }, [pane.cliSessionId, visible, refresh]);

  const onToggleExpand = useCallback(
    (next: boolean) => {
      expandedRef.current = next;
      setExpanded(next);
      if (next) void refresh(true);
      else setLoading(false);
    },
    [refresh]
  );

  const refreshIdle = useCallback(() => {
    void refresh(false);
  }, [refresh]);

  return {
    docs: artifacts.docs,
    links: artifacts.links,
    expanded,
    loading,
    onToggleExpand,
    refreshIdle,
  };
}
