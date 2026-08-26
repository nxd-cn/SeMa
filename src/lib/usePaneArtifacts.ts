import { useCallback, useEffect, useRef, useState } from "react";
import { tui, type ArtifactsResult } from "../api/tui";
import { useAppStore } from "../store/appStore";
import type { PaneState } from "../store/types";
import {
  artifactsCollectReady,
  artifactsKey,
  artifactsScopeKey,
} from "./artifactsRefresh";
import {
  ARTIFACTS_REFRESH_MIN_MS,
  isCurrentArtifactsRequest,
  runArtifactsRefresh,
  shouldClearArtifactsLoading,
  shouldShowLoading,
} from "./paneArtifactsRefresh";

const EMPTY: ArtifactsResult = { docs: [], links: [] };

export type ArtifactsMenuKind = "docs" | "links" | null;

export function usePaneArtifacts(pane: PaneState, visible: boolean) {
  const [artifacts, setArtifacts] = useState<ArtifactsResult>(EMPTY);
  const [openMenu, setOpenMenu] = useState<ArtifactsMenuKind>(null);
  const [loading, setLoading] = useState(false);
  const lastFetch = useRef(0);
  const fetchGenRef = useRef(0);
  const openMenuRef = useRef<ArtifactsMenuKind>(null);
  openMenuRef.current = openMenu;
  const boundKeyRef = useRef(artifactsKey(pane.cliSessionId));
  const resumeFetchedScopeRef = useRef("");
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
    if (!artifactsCollectReady(p)) {
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
    if (shouldShowLoading(openMenuRef.current !== null, force)) setLoading(true);
    const outcome = await runArtifactsRefresh({
      query: {
        cliId: p.cliId,
        cwd: p.cwd,
        cliSessionId: requested,
        artifactsIncludeHistory: p.artifactsIncludeHistory,
        artifactsSinceSeq: p.artifactsSinceSeq,
        resumeOfferPending: p.resumeOfferPending,
      },
      force: true,
      lastFetchMs: nowMs,
      nowMs,
      sessionArtifacts: (args) => tui.sessionArtifacts(args),
      currentBoundId: () =>
        useAppStore.getState().panes[p.id]?.cliSessionId,
      currentScope: () => {
        const cur = useAppStore.getState().panes[p.id];
        return {
          cliSessionId: cur?.cliSessionId,
          artifactsIncludeHistory: cur?.artifactsIncludeHistory,
          artifactsSinceSeq: cur?.artifactsSinceSeq,
          resumeOfferPending: cur?.resumeOfferPending,
        };
      },
    });
    const isCurrent = isCurrentArtifactsRequest(gen, fetchGenRef.current);
    if (shouldClearArtifactsLoading(isCurrent, outcome.kind)) {
      setLoading(false);
    }
    if (!isCurrent) return;
    if (outcome.kind === "stale") return;
    if (outcome.kind === "unbound" || outcome.kind === "no-baseline") {
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
      resumeFetchedScopeRef.current = "";
      setArtifacts(EMPTY);
      setOpenMenu(null);
      openMenuRef.current = null;
      lastFetch.current = 0;
      if (!key) {
        useAppStore.getState().updatePane(pane.id, {
          artifactsSinceSeq: null,
          artifactsIncludeHistory: false,
        });
      } else {
        const cur = useAppStore.getState().panes[pane.id];
        if (!cur?.artifactsIncludeHistory) {
          useAppStore.getState().updatePane(pane.id, {
            artifactsSinceSeq: undefined,
          });
        }
      }
    }
  }, [pane.cliSessionId, pane.id]);

  useEffect(() => {
    if (!artifactsCollectReady(pane)) {
      setArtifacts(EMPTY);
      lastFetch.current = 0;
    }
  }, [pane.artifactsSinceSeq, pane.artifactsIncludeHistory, pane.cliSessionId, pane.resumeOfferPending]);

  useEffect(() => {
    const key = artifactsKey(pane.cliSessionId);
    if (!key || !visible || pane.artifactsIncludeHistory) return;
    if (pane.resumeOfferPending) return;
    if (typeof pane.artifactsSinceSeq === "number") return;

    let cancelled = false;
    void tui
      .sessionArtifactsSeq({
        cliId: pane.cliId,
        cwd: pane.cwd,
        cliSessionId: key,
      })
      .then((seq) => {
        if (cancelled) return;
        const cur = useAppStore.getState().panes[pane.id];
        if (!cur || artifactsKey(cur.cliSessionId) !== key) return;
        if (cur.artifactsIncludeHistory) return;
        useAppStore.getState().updatePane(pane.id, { artifactsSinceSeq: seq });
      });
    return () => {
      cancelled = true;
    };
  }, [
    pane.id,
    pane.cliId,
    pane.cwd,
    pane.cliSessionId,
    pane.artifactsSinceSeq,
    pane.artifactsIncludeHistory,
    pane.resumeOfferPending,
    visible,
  ]);

  useEffect(() => {
    if (!pane.artifactsIncludeHistory || !visible || pane.resumeOfferPending) return;
    if (!artifactsCollectReady(pane)) return;
    const scope = artifactsScopeKey(pane);
    if (!scope || resumeFetchedScopeRef.current === scope) return;
    resumeFetchedScopeRef.current = scope;
    void refresh(true);
  }, [
    pane.artifactsIncludeHistory,
    pane.cliSessionId,
    pane.artifactsSinceSeq,
    pane.resumeOfferPending,
    visible,
    refresh,
  ]);

  const onToggleMenu = useCallback(
    (next: ArtifactsMenuKind) => {
      openMenuRef.current = next;
      setOpenMenu(next);
      if (next) void refresh(true);
      else setLoading(false);
    },
    [refresh],
  );

  const refreshIdle = useCallback(() => {
    void refresh(false);
  }, [refresh]);

  return {
    docs: artifacts.docs,
    links: artifacts.links,
    openMenu,
    loading,
    onToggleMenu,
    refreshIdle,
  };
}
