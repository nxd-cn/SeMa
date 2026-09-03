import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { tui, type ToolInfo } from "./api/tui";
import ActivityToast from "./components/ActivityToast";
import CliToolbar from "./components/CliToolbar";
import ContextMenu, { type ContextMenuState } from "./components/ContextMenu";
import MacTitleBar from "./components/MacTitleBar";
import Pane from "./components/Pane";
import Sidebar from "./components/Sidebar";
import TermColumnsScrollbar from "./components/TermColumnsScrollbar";
import type { TermHandle } from "./components/TerminalHost";
import { applyHorizontalWheel } from "./lib/horizontalWheel";
import { clampDocFontSize, clampTermFontSize } from "./lib/docFontZoom";
import { newSessionKeyAction } from "./lib/newSessionKeys";
import { reorderGroupList } from "./lib/reorderGroups";
import { sidebarToggleKeyAction } from "./lib/sidebarToggleKeys";
import { useAppUpdater } from "./lib/useAppUpdater";
import {
  looksLikeTurnOutput,
  shouldRefreshBusyTimer,
} from "./lib/activityOutput";
import {
  groupLabel,
  unreadGroupCount,
  useAppStore,
} from "./store/appStore";
import type { PaneState } from "./store/types";

const ACTIVITY_CLIS = new Set([
  "claude",
  "cursor",
  "opencode",
  "pi",
  "codex",
  "gemini",
  "kimi",
]);
const IDLE_MS = 2500;
/** After pulse ends, keep activityArmed so late tokens after a thinking gap can re-pulse. */
const ARM_HOLD_MS = 5 * 60 * 1000;
const MIN_FLEX = 0.15;

/** Survive React StrictMode remount so restore does not double-spawn. */
let bootStarted = false;

type CliModalState = { cwd: string } | null;
type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
} | null;

type ColDrag = {
  leftId: string;
  rightId: string;
  startX: number;
  leftFlex: number;
  rightFlex: number;
  leftW: number;
  rightW: number;
};

function cwdKey(cwd: string): string {
  return String(cwd || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function sameCwd(a: string, b: string): boolean {
  return cwdKey(a) === cwdKey(b);
}

export default function App() {
  const store = useAppStore();
  const { groups, panes, activeGroupId, sidebarCollapsed, tools } = store;

  const groupSeq = useRef(0);
  const terms = useRef<Map<string, TermHandle>>(new Map());

  const refitAfterResume = (sessionId: string) => {
    const run = () => terms.current.get(sessionId)?.refit();
    requestAnimationFrame(run);
    window.setTimeout(run, 50);
    window.setTimeout(run, 200);
    window.setTimeout(run, 500);
  };
  const idleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const armHoldTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const artifactsIdle = useRef<Map<string, () => void>>(new Map());
  const registerArtifactsIdle = useCallback(
    (paneId: string, fn: (() => void) | null) => {
      if (fn) artifactsIdle.current.set(paneId, fn);
      else artifactsIdle.current.delete(paneId);
    },
    []
  );
  const bindInFlight = useRef<Set<string>>(new Set());
  const followInFlight = useRef<Set<string>>(new Set());
  const followCliSessionRef = useRef<
    | ((
        sessionId: string,
        opts?: { timeoutMs?: number }
      ) => Promise<string | null>)
    | null
  >(null);
  const saveTail = useRef(Promise.resolve());
  const colDrag = useRef<ColDrag | null>(null);
  const sidebarDragging = useRef(false);
  const termColumnsRef = useRef<HTMLDivElement | null>(null);

  const [cliModal, setCliModal] = useState<CliModalState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  const updater = useAppUpdater();

  const showConfirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirm({ message, resolve });
    });
  }, []);

  const syncBadge = useCallback(() => {
    const n = unreadGroupCount(useAppStore.getState());
    void tui.setUnreadBadge(n);
  }, []);

  const persistLayout = useCallback(() => {
    const run = async () => {
      try {
        const s = useAppStore.getState();
        if (!Object.keys(s.panes).length) {
          await tui.setPrefs({ layout: null, split: null, last: null });
          return;
        }
        const saved: {
          panes: {
            cwd: string;
            cliId: string;
            flex: number;
            cliSessionId?: string;
          }[];
          focus: number;
          customTitle?: string;
        }[] = [];
        let activeGroupIndex = 0;
        for (const g of s.groups) {
          if (!g.paneIds.length) continue;
          if (s.activeGroupId === g.id) activeGroupIndex = saved.length;
          const focusId =
            s.focusedPaneId && g.paneIds.includes(s.focusedPaneId)
              ? s.focusedPaneId
              : g.focusId && g.paneIds.includes(g.focusId)
                ? g.focusId
                : g.paneIds[0];
          const customTitle = g.customTitle?.trim();
          saved.push({
            panes: g.paneIds.map((id) => {
              const p = s.panes[id];
              const pane: {
                cwd: string;
                cliId: string;
                flex: number;
                cliSessionId?: string;
              } = {
                cwd: p.cwd,
                cliId: p.cliId,
                flex: p.flex,
              };
              if (p.cliSessionId) pane.cliSessionId = p.cliSessionId;
              return pane;
            }),
            focus: Math.max(0, g.paneIds.indexOf(focusId)),
            ...(customTitle ? { customTitle } : {}),
          });
        }
        if (!saved.length) {
          await tui.setPrefs({ layout: null, split: null, last: null });
          return;
        }
        await tui.setPrefs({
          layout: { groups: saved, activeGroupIndex },
          split: null,
        });
      } catch {
        /* ignore */
      }
    };
    saveTail.current = saveTail.current.then(run, run);
    return saveTail.current;
  }, []);

  const usedCliSessionIds = useCallback(
    (cwd: string, exceptSessionId?: string) => {
      const s = useAppStore.getState();
      const used: string[] = [];
      for (const [sid, p] of Object.entries(s.panes)) {
        if (exceptSessionId && sid === exceptSessionId) continue;
        if (!p.cliSessionId) continue;
        if (cwd && !sameCwd(p.cwd, cwd)) continue;
        used.push(p.cliSessionId);
      }
      return used;
    },
    []
  );

  const userLookingAtGroup = useCallback(
    (groupId: string) => {
      const s = useAppStore.getState();
      if (s.activeGroupId !== groupId) return false;
      if (!s.windowFocused) return false;
      return true;
    },
    []
  );

  const dismissToast = useCallback((groupId: string) => {
    useAppStore.getState().removeToast(groupId);
  }, []);

  const clearGroupIdleTimer = useCallback((groupId: string) => {
    const timer = idleTimers.current.get(groupId);
    if (timer) clearTimeout(timer);
    idleTimers.current.delete(groupId);
  }, []);

  const clearGroupArmHold = useCallback((groupId: string) => {
    const timer = armHoldTimers.current.get(groupId);
    if (timer) clearTimeout(timer);
    armHoldTimers.current.delete(groupId);
  }, []);

  const disarmGroupActivity = useCallback((groupId: string) => {
    armHoldTimers.current.delete(groupId);
    const s = useAppStore.getState();
    const g = s.groups.find((x) => x.id === groupId);
    if (!g || g.busy) return;
    for (const pid of g.paneIds) {
      s.updatePane(pid, { activityArmed: false });
    }
  }, []);

  /**
   * Post-turn ARM_HOLD keeps activityArmed so a thinking gap can re-pulse.
   * Leaving / opening an idle tab must drop that hold — park/unpark layout and
   * TUI chrome redraws otherwise re-trigger the green pulse on a finished turn.
   * Still-busy groups and submit-awaiting-first-token (armed, no hold) are kept.
   */
  const disarmPostTurnIdle = useCallback(
    (groupId: string) => {
      const s = useAppStore.getState();
      const g = s.groups.find((x) => x.id === groupId);
      if (!g || g.busy) return;
      if (!armHoldTimers.current.has(groupId)) return;
      clearGroupArmHold(groupId);
      for (const pid of g.paneIds) {
        s.updatePane(pid, { activityArmed: false });
      }
    },
    [clearGroupArmHold]
  );

  const clearGroupActivity = useCallback(
    (groupId: string) => {
      clearGroupIdleTimer(groupId);
      clearGroupArmHold(groupId);
      const s = useAppStore.getState();
      s.setBusy(groupId, false);
      for (const pid of s.groups.find((g) => g.id === groupId)?.paneIds || []) {
        s.updatePane(pid, { activityArmed: false });
      }
      s.setUnread(groupId, false);
      dismissToast(groupId);
      syncBadge();
    },
    [clearGroupArmHold, clearGroupIdleTimer, dismissToast, syncBadge]
  );

  const markGroupIdle = useCallback(
    (groupId: string) => {
      idleTimers.current.delete(groupId);
      const s = useAppStore.getState();
      const g = s.groups.find((x) => x.id === groupId);
      if (!g || !g.busy) return;
      s.setBusy(groupId, false);
      // Keep activityArmed across thinking gaps: early TUI echo can start the
      // idle clock, then the model is silent > IDLE_MS before real tokens.
      // Soft-disarm later so post-turn redraws do not pulse forever.
      clearGroupArmHold(groupId);
      armHoldTimers.current.set(
        groupId,
        setTimeout(() => disarmGroupActivity(groupId), ARM_HOLD_MS)
      );
      for (const pid of g.paneIds) {
        void followCliSessionRef.current?.(pid, { timeoutMs: 0 });
        artifactsIdle.current.get(pid)?.();
      }
      if (userLookingAtGroup(groupId)) return;
      s.setUnread(groupId, true);
      s.addToast({ groupId, label: groupLabel(g, s.panes) });
      syncBadge();
    },
    [clearGroupArmHold, disarmGroupActivity, syncBadge, userLookingAtGroup]
  );

  const noteActivity = useCallback(
    (sessionId: string, data: string) => {
      const s = useAppStore.getState();
      const p = s.panes[sessionId];
      if (!p || !p.activityArmed || !ACTIVITY_CLIS.has(p.cliId)) return;
      const group = s.groups.find((g) => g.paneIds.includes(sessionId));
      if (!group) return;
      const qualifying = looksLikeTurnOutput(data);
      if (!shouldRefreshBusyTimer(!!group.busy, data, qualifying)) return;
      clearGroupArmHold(group.id);
      s.setBusy(group.id, true);
      const prev = idleTimers.current.get(group.id);
      if (prev) clearTimeout(prev);
      idleTimers.current.set(
        group.id,
        setTimeout(() => markGroupIdle(group.id), IDLE_MS)
      );
    },
    [clearGroupArmHold, markGroupIdle]
  );

  const bindCliSession = useCallback(
    async (sessionId: string) => {
      const s0 = useAppStore.getState();
      const v = s0.panes[sessionId];
      if (
        !v ||
        v.cliId === "terminal" ||
        v.cliSessionId ||
        bindInFlight.current.has(sessionId)
      ) {
        return;
      }
      bindInFlight.current.add(sessionId);
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const found = await tui.discoverCliSession({
            sessionId,
            cliId: v.cliId,
            cwd: v.cwd,
            excludeIds: usedCliSessionIds(v.cwd, sessionId),
          });
          const s = useAppStore.getState();
          const v2 = s.panes[sessionId];
          if (!v2 || v2.cliSessionId) return;
          if (!found?.cliSessionId) return;
          if (
            usedCliSessionIds(v2.cwd, sessionId).includes(found.cliSessionId)
          ) {
            continue;
          }
      s.updatePane(sessionId, { cliSessionId: found.cliSessionId, artifactsIncludeHistory: false, artifactsSinceSeq: undefined });
          await persistLayout();
          return;
        }
      } catch {
        /* best-effort */
      } finally {
        bindInFlight.current.delete(sessionId);
      }
    },
    [persistLayout, usedCliSessionIds]
  );

  /** Claude `/clear` (and similar) create a new on-disk id; keep pane binding current. */
  const followCliSession = useCallback(
    async (
      sessionId: string,
      opts?: { timeoutMs?: number }
    ): Promise<string | null> => {
      const s0 = useAppStore.getState();
      const v = s0.panes[sessionId];
      if (!v?.cliSessionId || v.cliId === "terminal") return null;
      if (followInFlight.current.has(sessionId)) return null;
      const expected = v.cliSessionId;
      followInFlight.current.add(sessionId);
      try {
        const found = await tui.followCliSession({
          sessionId,
          cliId: v.cliId,
          cwd: v.cwd,
          currentId: expected,
          excludeIds: usedCliSessionIds(v.cwd, sessionId),
          timeoutMs: opts?.timeoutMs,
        });
        const s = useAppStore.getState();
        const v2 = s.panes[sessionId];
        // Binding cleared (/clear) or changed while we polled — do not clobber.
        if (!v2?.cliSessionId || v2.cliSessionId !== expected) return null;
        const next = found?.cliSessionId;
        if (!next || next === expected) return null;
        if (usedCliSessionIds(v2.cwd, sessionId).includes(next)) return null;
        s.updatePane(sessionId, { cliSessionId: next, artifactsIncludeHistory: false, artifactsSinceSeq: undefined });
        await persistLayout();
        return next;
      } catch {
        return null;
      } finally {
        followInFlight.current.delete(sessionId);
      }
    },
    [persistLayout, usedCliSessionIds]
  );
  followCliSessionRef.current = followCliSession;

  const onCliSessionCleared = useCallback(
    (sessionId: string) => {
      const s = useAppStore.getState();
      const v = s.panes[sessionId];
      if (!v?.cliSessionId) return;
      s.updatePane(sessionId, { cliSessionId: null, artifactsSinceSeq: null, artifactsIncludeHistory: false });
      void persistLayout();
    },
    [persistLayout]
  );

  /**
   * Typing / paste before Enter must not green-pulse. Post-turn ARM_HOLD leaves
   * activityArmed so late tokens can re-pulse; TUI echo of keystrokes would
   * otherwise look like turn output. Only drop that hold — mid-turn busy and
   * post-Enter await (armed, no hold) stay armed.
   */
  const noticeUserComposing = useCallback(
    (sessionId: string) => {
      const s = useAppStore.getState();
      const v = s.panes[sessionId];
      if (!v || !ACTIVITY_CLIS.has(v.cliId) || !v.activityArmed) return;
      const group = s.groups.find((g) => g.paneIds.includes(sessionId));
      if (!group || group.busy) return;
      if (!armHoldTimers.current.has(group.id)) return;
      clearGroupArmHold(group.id);
      s.updatePane(sessionId, { activityArmed: false });
    },
    [clearGroupArmHold]
  );

  const noticeUserStartedChat = useCallback(
    (sessionId: string) => {
      const s = useAppStore.getState();
      const v = s.panes[sessionId];
      if (!v) return;
      const group = s.groups.find((g) => g.paneIds.includes(sessionId));
      if (ACTIVITY_CLIS.has(v.cliId) && group) {
        // Drop a previous turn's pending idle so it cannot disarm this submit
        // before the next PTY chunk arrives.
        clearGroupIdleTimer(group.id);
        clearGroupArmHold(group.id);
        if (group.busy) {
          idleTimers.current.set(
            group.id,
            setTimeout(() => markGroupIdle(group.id), IDLE_MS)
          );
        }
      }
      const abandonResumeOffer = !!v.resumeOfferPending;
      const armActivity = ACTIVITY_CLIS.has(v.cliId);
      s.updatePane(sessionId, {
        ...(armActivity ? { activityArmed: true } : {}),
        continueDismissed: true,
        resumeOfferPending: false,
      });
      // Re-read: /clear handler may have just nulled the binding.
      const bound = useAppStore.getState().panes[sessionId]?.cliSessionId;
      if (abandonResumeOffer) {
        if (bound) {
          s.updatePane(sessionId, { cliSessionId: null });
          void persistLayout();
        }
        void bindCliSession(sessionId);
      } else if (!bound) {
        void bindCliSession(sessionId);
      } else {
        void followCliSession(sessionId);
      }
    },
    [
      bindCliSession,
      clearGroupArmHold,
      clearGroupIdleTimer,
      followCliSession,
      markGroupIdle,
      persistLayout,
    ]
  );

  const setActivePane = useCallback(
    (paneId: string, opts?: { skipSave?: boolean }) => {
      const s = useAppStore.getState();
      if (!s.panes[paneId]) return;
      const alreadyFocused = s.focusedPaneId === paneId;
      s.setActive(paneId);
      syncBadge();
      if (!opts?.skipSave) void persistLayout();
      // Refocus only when switching panes — clicking the active pane to
      // select scrollback must not scroll or steal the selection gesture.
      if (!alreadyFocused) {
        requestAnimationFrame(() => {
          terms.current.get(paneId)?.focus();
        });
      }
    },
    [persistLayout, syncBadge]
  );

  const activateGroup = useCallback(
    (groupId: string) => {
      const s = useAppStore.getState();
      const g = s.groups.find((x) => x.id === groupId);
      if (!g || !g.paneIds.length) return;
      const prevId = s.activeGroupId;
      if (prevId && prevId !== groupId) {
        disarmPostTurnIdle(prevId);
      }
      // Unparking also refits and can redraw a finished TUI — settle target too.
      disarmPostTurnIdle(groupId);
      const focus =
        g.focusId && g.paneIds.includes(g.focusId)
          ? g.focusId
          : g.paneIds[0];
      setActivePane(focus);
    },
    [disarmPostTurnIdle, setActivePane]
  );

  const renameGroup = useCallback(
    (groupId: string, customTitle: string | null) => {
      useAppStore.getState().updateGroup(groupId, { customTitle });
      void persistLayout();
    },
    [persistLayout]
  );

  const openSession = useCallback(
    async (
      cwd: string,
      cliId: string,
      opts?: {
        silent?: boolean;
        skipSave?: boolean;
        groupId?: string;
        flex?: number;
        cliSessionId?: string;
      }
    ): Promise<string | null> => {
      let result;
      try {
        result = await tui.createSession({ cwd, cliId });
      } catch (err) {
        if (!opts?.silent) {
          alert(err instanceof Error ? err.message : String(err));
        }
        return null;
      }

      const s = useAppStore.getState();
      const groupId = opts?.groupId || `g-${++groupSeq.current}`;
      const flex =
        opts && typeof opts.flex === "number" && opts.flex > 0 ? opts.flex : 1;
      const boundFromLayout = opts?.cliSessionId
        ? String(opts.cliSessionId)
        : null;
      const boundId =
        boundFromLayout ||
        (result.cliSessionId ? String(result.cliSessionId) : null);

      const pane: PaneState = {
        id: result.id,
        cwd,
        cliId,
        flex,
        label: result.label,
        canResume: !!result.canResume,
        cliSessionId: boundId,
        artifactsIncludeHistory: false,
        artifactsSinceSeq: undefined,
        continueDismissed: false,
        resumeOfferPending: false,
        activityArmed: false,
        knownBefore: Array.isArray(result.knownBefore)
          ? result.knownBefore.map(String)
          : [],
      };
      if (cliId !== "terminal" && (boundFromLayout || result.canResume)) {
        pane.resumeOfferPending = true;
      }

      s.upsertPane(pane);
      const s2 = useAppStore.getState();
      const existing = s2.groups.find((g) => g.id === groupId);
      if (existing) {
        if (!existing.paneIds.includes(result.id)) {
          s2.upsertGroup({
            ...existing,
            paneIds: [...existing.paneIds, result.id],
            focusId: result.id,
          });
        }
      } else {
        s2.upsertGroup({
          id: groupId,
          paneIds: [result.id],
          focusId: result.id,
        });
      }

      setActivePane(result.id, { skipSave: opts?.skipSave });
      if (!opts?.skipSave) void persistLayout();
      return result.id;
    },
    [persistLayout, setActivePane]
  );

  const equalizePaneFlex = useCallback((paneIds: string[]) => {
    const s = useAppStore.getState();
    const n = Math.max(1, paneIds.length);
    const flex = 1 / n;
    for (const pid of paneIds) {
      if (s.panes[pid]) s.updatePane(pid, { flex });
    }
  }, []);

  const refitPanes = useCallback((paneIds: string[]) => {
    requestAnimationFrame(() => {
      for (const pid of paneIds) {
        terms.current.get(pid)?.refit();
      }
    });
    window.setTimeout(() => {
      for (const pid of paneIds) {
        terms.current.get(pid)?.refit();
      }
    }, 80);
  }, []);

  const closeSession = useCallback(
    async (id: string) => {
      const s = useAppStore.getState();
      const pane = s.panes[id];
      if (!pane) return;
      const group = s.groups.find((g) => g.paneIds.includes(id));
      const groupId = group?.id;

      // Focus survivor before removing (IME handoff).
      if (group) {
        const others = group.paneIds.filter((pid) => pid !== id);
        if (others.length) {
          const next =
            s.focusedPaneId && others.includes(s.focusedPaneId)
              ? s.focusedPaneId
              : others[0];
          s.setActive(next);
        } else {
          const otherGroup = s.groups.find(
            (g) => g.id !== group.id && g.paneIds.length
          );
          if (otherGroup) {
            s.setActive(otherGroup.focusId || otherGroup.paneIds[0]);
          }
        }
      }

      terms.current.delete(id);
      s.removePane(id);

      if (groupId) {
        const s2 = useAppStore.getState();
        const g2 = s2.groups.find((g) => g.id === groupId);
        if (g2?.paneIds.length) {
          equalizePaneFlex(g2.paneIds);
          refitPanes(g2.paneIds);
        }
        const stillActive = g2?.paneIds.some((pid) =>
          ACTIVITY_CLIS.has(s2.panes[pid]?.cliId || "")
        );
        if (!stillActive) clearGroupActivity(groupId);
      }

      try {
        await tui.killSession(id);
      } catch {
        /* UI already closed */
      }
      await persistLayout();
      syncBadge();
    },
    [clearGroupActivity, equalizePaneFlex, persistLayout, refitPanes, syncBadge]
  );

  const closeGroup = useCallback(
    async (groupId: string) => {
      const s = useAppStore.getState();
      const g = s.groups.find((x) => x.id === groupId);
      if (!g) return;
      const label = groupLabel(g, s.panes);
      const ok = await showConfirm(`关闭整组 ${label}?`);
      if (!ok) {
        if (s.focusedPaneId) terms.current.get(s.focusedPaneId)?.focus();
        return;
      }
      clearGroupActivity(groupId);
      const ids = g.paneIds.slice();
      for (const id of ids) {
        terms.current.delete(id);
        useAppStore.getState().removePane(id);
        try {
          await tui.killSession(id);
        } catch {
          /* ignore */
        }
      }
      await persistLayout();
      syncBadge();
      const s2 = useAppStore.getState();
      if (s2.focusedPaneId) terms.current.get(s2.focusedPaneId)?.focus();
    },
    [clearGroupActivity, persistLayout, showConfirm, syncBadge]
  );

  const detachSession = useCallback(
    (id: string) => {
      const s = useAppStore.getState();
      const group = s.groups.find((g) => g.paneIds.includes(id));
      if (!group || group.paneIds.length <= 1) return;
      const newGroupId = `g-${++groupSeq.current}`;
      const oldIdx = s.groups.findIndex((g) => g.id === group.id);
      const remaining = group.paneIds.filter((pid) => pid !== id);
      const updatedGroups = s.groups.slice();
      updatedGroups[oldIdx] = {
        ...group,
        paneIds: remaining,
        focusId:
          group.focusId === id
            ? remaining[0]
            : group.focusId,
      };
      updatedGroups.splice(oldIdx + 1, 0, {
        id: newGroupId,
        paneIds: [id],
        focusId: id,
      });
      s.setGroups(updatedGroups);
      // Remaining columns + detached solo must reclaim full width (merge left flex=0.5).
      equalizePaneFlex(remaining);
      equalizePaneFlex([id]);
      setActivePane(id);
      void persistLayout();
      refitPanes([...remaining, id]);
    },
    [equalizePaneFlex, persistLayout, refitPanes, setActivePane]
  );

  const mergeGroups = useCallback(
    (sourceGroupId: string, targetGroupId: string) => {
      if (!sourceGroupId || sourceGroupId === targetGroupId) return;
      const s = useAppStore.getState();
      const src = s.groups.find((g) => g.id === sourceGroupId);
      const tgt = s.groups.find((g) => g.id === targetGroupId);
      if (!src || !tgt) return;
      clearGroupActivity(sourceGroupId);
      const focusKeep = tgt.focusId;
      const mergedPaneIds = [...tgt.paneIds, ...src.paneIds];
      const merged = {
        ...tgt,
        paneIds: mergedPaneIds,
        focusId:
          focusKeep && mergedPaneIds.includes(focusKeep)
            ? focusKeep
            : mergedPaneIds[0],
        unread: false,
      };
      s.setGroups(
        s.groups
          .filter((g) => g.id !== sourceGroupId)
          .map((g) => (g.id === targetGroupId ? merged : g))
      );
      equalizePaneFlex(mergedPaneIds);
      const focus = merged.focusId;
      setActivePane(focus);
      void persistLayout();
      refitPanes(mergedPaneIds);
      requestAnimationFrame(() => terms.current.get(focus)?.focus());
    },
    [clearGroupActivity, equalizePaneFlex, persistLayout, refitPanes, setActivePane]
  );

  const reorderGroups = useCallback(
    (sourceGroupId: string, insertBeforeIndex: number) => {
      const s = useAppStore.getState();
      const next = reorderGroupList(s.groups, sourceGroupId, insertBeforeIndex);
      if (next === s.groups) return;
      s.setGroups(next);
      void persistLayout();
    },
    [persistLayout]
  );

  const onContinue = useCallback(
    async (sessionId: string) => {
      const s = useAppStore.getState();
      let cur = s.panes[sessionId];
      if (!cur) return;
      s.updatePane(sessionId, {
        continueDismissed: true,
        resumeOfferPending: false,
        artifactsIncludeHistory: true,
        artifactsSinceSeq: undefined,
      });
      if (cur.cliSessionId) {
        await followCliSession(sessionId, { timeoutMs: 3000 });
        cur = useAppStore.getState().panes[sessionId] || cur;
      }
      const handle = terms.current.get(sessionId);
      // Fit first so spawn uses the real pane size (avoids TUI drawing at 120×40).
      handle?.refit();
      const cols = Math.max(20, handle?.cols() || 120);
      const rows = Math.max(5, handle?.rows() || 40);
      handle?.resetClear();
      try {
        const result = await tui.respawnSession({
          id: sessionId,
          cwd: cur.cwd,
          cliId: cur.cliId,
          cliSessionId: cur.cliSessionId || undefined,
          excludeIds: usedCliSessionIds(cur.cwd, sessionId),
          cols,
          rows,
        });
        refitAfterResume(sessionId);
        handle?.focus();
        if (result?.fallback) {
          s.updatePane(sessionId, { cliSessionId: null });
          await persistLayout();
        } else if (result?.cliSessionId) {
          s.updatePane(sessionId, { cliSessionId: result.cliSessionId });
          await persistLayout();
        } else if (result && result.usedBound === false) {
          s.updatePane(sessionId, { cliSessionId: null });
          await persistLayout();
          void bindCliSession(sessionId);
        }
      } catch {
        try {
          handle?.resetClear();
          s.updatePane(sessionId, { cliSessionId: null });
          await persistLayout();
          await tui.respawnSession({
            id: sessionId,
            cwd: cur.cwd,
            cliId: cur.cliId,
            cols,
            rows,
          });
          refitAfterResume(sessionId);
          handle?.focus();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [bindCliSession, followCliSession, persistLayout, usedCliSessionIds]
  );

  const startNewSession = useCallback(async () => {
    const picked = await tui.pickFolder();
    if (picked.canceled || !picked.path) return;
    setCliModal({ cwd: picked.path });
  }, []);

  const pickCli = useCallback(
    async (tool: ToolInfo) => {
      const folder = cliModal?.cwd;
      setCliModal(null);
      if (folder) await openSession(folder, tool.id);
    },
    [cliModal, openSession]
  );

  const openToolInFocused = useCallback(
    async (cliId: string) => {
      const s = useAppStore.getState();
      let cwd: string | null = null;
      let groupId: string | null = null;
      if (s.focusedPaneId && s.panes[s.focusedPaneId]) {
        const v = s.panes[s.focusedPaneId];
        cwd = v.cwd;
        groupId =
          s.groups.find((g) => g.paneIds.includes(s.focusedPaneId!))?.id ??
          null;
      } else if (s.groups.length) {
        const g = s.groups[s.groups.length - 1];
        const lastId = g.paneIds[g.paneIds.length - 1];
        const v = s.panes[lastId];
        if (v) {
          cwd = v.cwd;
          groupId = g.id;
        }
      }
      if (!cwd || !groupId) return;
      await openSession(cwd, cliId, { groupId });
    },
    [openSession]
  );

  const toggleSidebar = useCallback(async () => {
    const next = !useAppStore.getState().sidebarCollapsed;
    useAppStore.getState().setSidebarCollapsed(next);
    try {
      await tui.setPrefs({ sidebarCollapsed: next });
    } catch {
      /* ignore */
    }
  }, []);

  // In-app only: key events fire solely while SeMa's window is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const opts = { isMac: tui.isMac };
      if (newSessionKeyAction(e, opts) === "newSession") {
        e.preventDefault();
        e.stopPropagation();
        void startNewSession();
        return;
      }
      if (sidebarToggleKeyAction(e, opts) === "toggleSidebar") {
        e.preventDefault();
        e.stopPropagation();
        void toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [startNewSession, toggleSidebar]);

  // Split strip: vertical mouse wheel → horizontal scroll (Win + Mac).
  useEffect(() => {
    const el = termColumnsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      applyHorizontalWheel(el, e);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onCtxAction = useCallback(
    async (action: "copy" | "paste" | "delete" | "selectAll") => {
      const menu = ctxMenu;
      setCtxMenu(null);
      if (!menu) return;
      const handle = terms.current.get(menu.paneId);
      if (!handle) return;
      if (action === "copy") {
        void tui.clipboardWrite(handle.getSelection());
      } else if (action === "paste") {
        const text = await tui.clipboardRead();
        if (text) {
          if (tui.dataLooksLikeSubmit(text)) {
            noticeUserStartedChat(menu.paneId);
          } else {
            noticeUserComposing(menu.paneId);
          }
          void tui.write(menu.paneId, text);
        }
      } else if (action === "delete") {
        const payload = tui.selectionDeletePayload(handle.getSelection());
        handle.clearSelection();
        if (payload) void tui.write(menu.paneId, payload);
      } else if (action === "selectAll") {
        handle.selectAll();
      }
    },
    [ctxMenu, noticeUserComposing, noticeUserStartedChat]
  );

  // Boot: prefs + CLI list + restore layout
  useEffect(() => {
    if (bootStarted) return;
    bootStarted = true;
    void (async () => {
      try {
        const prefs = await tui.getPrefs();
        const st = useAppStore.getState();
        if (prefs.sidebarWidth) st.setSidebarWidth(prefs.sidebarWidth);
        st.setSidebarCollapsed(!!prefs.sidebarCollapsed);
        if (prefs.homeDir) st.setHomeDir(prefs.homeDir);
        if (typeof prefs.docFontSize === "number") {
          st.setDocFontSize(clampDocFontSize(prefs.docFontSize));
        }
        if (typeof prefs.termFontSize === "number") {
          st.setTermFontSize(clampTermFontSize(prefs.termFontSize));
        }

        const { tools: listed } = await tui.listCli();
        st.setTools(listed);
        const toolIds = new Set(listed.map((t) => t.id));

        type PaneSpec = {
          cwd: string;
          cliId: string;
          flex?: number;
          cliSessionId?: string;
        };
        type GroupSpec = {
          panes: PaneSpec[];
          focus?: number;
          customTitle?: string | null;
        };

        let groupsSpec: GroupSpec[] | null = null;
        let activeGroupIndex = 0;
        const layout = prefs.layout as {
          groups?: GroupSpec[];
          activeGroupIndex?: number;
        } | null;
        const split = prefs.split as {
          cwd?: string;
          panes?: { cliId: string; flex?: number }[];
          focus?: number;
        } | null;

        if (layout?.groups?.length) {
          groupsSpec = layout.groups;
          activeGroupIndex =
            typeof layout.activeGroupIndex === "number"
              ? layout.activeGroupIndex
              : 0;
        } else if (split?.cwd && Array.isArray(split.panes) && split.panes.length) {
          groupsSpec = [
            {
              panes: split.panes.map((p) => ({
                cwd: split.cwd!,
                cliId: p.cliId,
                flex: p.flex,
              })),
              focus: split.focus || 0,
            },
          ];
        }

        if (!groupsSpec?.length) {
          syncBadge();
          return;
        }

        let focusSessionId: string | null = null;
        let any = false;
        for (let gi = 0; gi < groupsSpec.length; gi++) {
          const gspec = groupsSpec[gi];
          if (!gspec?.panes?.length) continue;
          const filtered = gspec.panes.filter(
            (p) => p && p.cwd && toolIds.has(p.cliId)
          );
          if (!filtered.length) continue;
          const groupId = `g-${++groupSeq.current}`;
          const focusIndex =
            typeof gspec.focus === "number" && gspec.focus >= 0
              ? gspec.focus
              : 0;
          const opened: string[] = [];
          for (const p of filtered) {
            const flex =
              typeof p.flex === "number" && p.flex > 0 ? p.flex : 1;
            let resumeId = p.cliSessionId ? String(p.cliSessionId) : undefined;
            if (resumeId) {
              try {
                const exclude = [
                  ...usedCliSessionIds(p.cwd),
                  ...filtered
                    .filter((x) => x !== p && x.cliSessionId)
                    .map((x) => String(x.cliSessionId)),
                ];
                const followed = await tui.followCliSession({
                  cliId: p.cliId,
                  cwd: p.cwd,
                  currentId: resumeId,
                  excludeIds: exclude,
                  timeoutMs: 0,
                });
                if (followed?.cliSessionId) resumeId = followed.cliSessionId;
              } catch {
                /* keep layout id */
              }
            }
            const id = await openSession(p.cwd, p.cliId, {
              silent: true,
              groupId,
              flex,
              skipSave: true,
              cliSessionId: resumeId,
            });
            if (id) opened.push(id);
            any = true;
          }
          if (!opened.length) continue;
          const localFocus =
            opened[Math.min(focusIndex, opened.length - 1)];
          useAppStore.getState().updateGroup(groupId, {
            focusId: localFocus,
          });
          const title =
            typeof gspec.customTitle === "string"
              ? gspec.customTitle.trim()
              : "";
          if (title) {
            useAppStore.getState().updateGroup(groupId, {
              customTitle: title,
            });
          }
          if (gi === activeGroupIndex || focusSessionId === null) {
            focusSessionId = localFocus;
          }
        }
        if (any && focusSessionId) {
          setActivePane(focusSessionId);
          await persistLayout();
        }
        syncBadge();
      } catch (err) {
        console.error(err);
      }
    })();
  }, [openSession, persistLayout, setActivePane, syncBadge]);

  // Window focus / visibility → clear unread if looking
  useEffect(() => {
    const clearIfLooking = () => {
      useAppStore.getState().setWindowFocused(true);
      const s = useAppStore.getState();
      if (!s.activeGroupId || !userLookingAtGroup(s.activeGroupId)) return;
      const g = s.groups.find((x) => x.id === s.activeGroupId);
      if (!g?.unread) return;
      s.setUnread(g.id, false);
      dismissToast(g.id);
      syncBadge();
    };
    const onBlur = () => {
      useAppStore.getState().setWindowFocused(false);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") clearIfLooking();
      else useAppStore.getState().setWindowFocused(false);
    };
    window.addEventListener("focus", clearIfLooking);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", clearIfLooking);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [dismissToast, syncBadge, userLookingAtGroup]);

  // Column resize drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (colDrag.current) {
        const d = colDrag.current;
        const s = useAppStore.getState();
        const left = s.panes[d.leftId];
        const right = s.panes[d.rightId];
        if (!left || !right) return;
        const dx = e.clientX - d.startX;
        const totalW = d.leftW + d.rightW;
        const totalFlex = d.leftFlex + d.rightFlex;
        if (totalW <= 0 || totalFlex <= 0) return;
        let newLeftW = d.leftW + dx;
        newLeftW = Math.max(0, Math.min(totalW, newLeftW));
        let newLeftFlex = (newLeftW / totalW) * totalFlex;
        newLeftFlex = Math.max(
          MIN_FLEX,
          Math.min(totalFlex - MIN_FLEX, newLeftFlex)
        );
        s.updatePane(d.leftId, { flex: newLeftFlex });
        s.updatePane(d.rightId, { flex: totalFlex - newLeftFlex });
        return;
      }
      if (sidebarDragging.current && !useAppStore.getState().sidebarCollapsed) {
        const w = Math.min(400, Math.max(100, e.clientX));
        useAppStore.getState().setSidebarWidth(w);
      }
    };
    const onUp = () => {
      if (colDrag.current) {
        colDrag.current = null;
        void persistLayout();
      }
      if (sidebarDragging.current) {
        sidebarDragging.current = false;
        const width = useAppStore.getState().sidebarWidth;
        void tui.setPrefs({ sidebarWidth: width });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [persistLayout]);

  // Cleanup activity timers on unmount
  useEffect(() => {
    return () => {
      for (const t of idleTimers.current.values()) clearTimeout(t);
      idleTimers.current.clear();
      for (const t of armHoldTimers.current.values()) clearTimeout(t);
      armHoldTimers.current.clear();
      artifactsIdle.current.clear();
      void tui.setUnreadBadge(0);
    };
  }, []);

  // Render all panes (inactive groups parked via CSS) so xterm stays alive.
  const allPaneEntries = groups.flatMap((g) =>
    g.paneIds.map((id) => ({
      pane: panes[id],
      groupId: g.id,
      showDetach: g.paneIds.length >= 2,
      visible: g.id === activeGroupId,
    }))
  );

  const isMac = tui.isMac;
  const appClass = [
    sidebarCollapsed ? "sidebar-collapsed" : "",
    isMac ? "platform-mac" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div id="app" className={appClass}>
      {isMac ? (
        <MacTitleBar
          onNewSession={startNewSession}
          onToggleSidebar={() => void toggleSidebar()}
          onOpenTool={(cliId) => void openToolInFocused(cliId)}
        />
      ) : null}
      <div id="app-body">
        <Sidebar
          onNewSession={startNewSession}
          onActivateGroup={activateGroup}
          onCloseGroup={(gid) => void closeGroup(gid)}
          onMergeGroups={mergeGroups}
          onReorderGroups={reorderGroups}
          onRenameGroup={renameGroup}
          hideNewButton={isMac}
          updater={updater}
        />
        <div
          id="sidebar-resizer"
          title="拖动调整宽度"
          onMouseDown={(e) => {
            if (sidebarCollapsed) return;
            sidebarDragging.current = true;
            e.preventDefault();
          }}
        />
        <main id="term-host">
          {isMac ? null : (
            <CliToolbar
              onToggleSidebar={() => void toggleSidebar()}
              onOpenTool={(cliId) => void openToolInFocused(cliId)}
            />
          )}
          <div id="term-stage">
            <ActivityToast onSelect={activateGroup} />
            <div className="term-columns-shell">
              <div id="term-columns" ref={termColumnsRef}>
                {allPaneEntries.map(({ pane, showDetach, visible, groupId }) => {
                  if (!pane) return null;
                  const ids = groups.find((g) => g.id === groupId)?.paneIds ?? [];
                  const idx = ids.indexOf(pane.id);
                  const showResizer =
                    visible && idx >= 0 && idx < ids.length - 1;
                  const rightId = showResizer ? ids[idx + 1] : null;
                  return (
                    <Fragment key={pane.id}>
                      <Pane
                        pane={pane}
                        visible={visible}
                        showDetach={showDetach}
                        flex={pane.flex}
                        onFocus={() => setActivePane(pane.id)}
                        onClose={() => void closeSession(pane.id)}
                        onDetach={() => detachSession(pane.id)}
                        onContinue={() => void onContinue(pane.id)}
                        onSubmitChat={() => noticeUserStartedChat(pane.id)}
                        onUserComposing={() => noticeUserComposing(pane.id)}
                        onCliSessionCleared={() => onCliSessionCleared(pane.id)}
                        onActivityData={(data) => noteActivity(pane.id, data)}
                        onRegisterArtifactsIdle={registerArtifactsIdle}
                        onContextMenu={(x, y, hasSel) =>
                          setCtxMenu({
                            x,
                            y,
                            paneId: pane.id,
                            hasSelection: hasSel,
                          })
                        }
                        onExit={() => void closeSession(pane.id)}
                        onTermReady={(handle) => {
                          if (handle) terms.current.set(pane.id, handle);
                          else terms.current.delete(pane.id);
                        }}
                      />
                      {showResizer && rightId ? (
                        <div
                          className="col-resizer"
                          title="拖动调整列宽"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const leftEl = (e.target as HTMLElement)
                              .previousElementSibling as HTMLElement | null;
                            const rightEl = (e.target as HTMLElement)
                              .nextElementSibling as HTMLElement | null;
                            const left = panes[pane.id];
                            const right = panes[rightId];
                            if (!left || !right) return;
                            colDrag.current = {
                              leftId: pane.id,
                              rightId,
                              startX: e.clientX,
                              leftFlex: left.flex,
                              rightFlex: right.flex,
                              leftW:
                                leftEl?.getBoundingClientRect().width ?? 200,
                              rightW:
                                rightEl?.getBoundingClientRect().width ?? 200,
                            };
                          }}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
              <TermColumnsScrollbar
                scrollRef={termColumnsRef}
                layoutKey={allPaneEntries
                  .filter((e) => e.visible && e.pane)
                  .map((e) => `${e.pane!.id}:${e.pane!.flex}`)
                  .join("|")}
              />
            </div>
          </div>
        </main>
      </div>

      <ContextMenu
        menu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        onAction={(a) => void onCtxAction(a)}
      />

      <div
        id="cli-modal"
        className={`modal${cliModal ? "" : " hidden"}`}
        aria-hidden={cliModal ? "false" : "true"}
      >
        <div className="modal-card">
          <div className="modal-title">选择 CLI</div>
          <ul id="cli-list">
            {tools.map((tool) => (
              <li
                key={tool.id}
                title={tool.path || tool.command}
                onClick={() => void pickCli(tool)}
              >
                {tool.label}
              </li>
            ))}
          </ul>
          <button
            id="cli-cancel"
            type="button"
            onClick={() => setCliModal(null)}
          >
            取消
          </button>
        </div>
      </div>

      <div
        id="confirm-modal"
        className={`modal${confirm ? "" : " hidden"}`}
        aria-hidden={confirm ? "false" : "true"}
        onKeyDown={(e) => {
          if (!confirm) return;
          if (e.key === "Escape") {
            e.preventDefault();
            confirm.resolve(false);
            setConfirm(null);
          } else if (e.key === "Enter") {
            e.preventDefault();
            confirm.resolve(true);
            setConfirm(null);
          }
        }}
      >
        <div className="modal-card">
          <div className="modal-title" id="confirm-message">
            {confirm?.message || "确认"}
          </div>
          <div className="modal-actions">
            <button
              id="confirm-ok"
              type="button"
              autoFocus
              onClick={() => {
                confirm?.resolve(true);
                setConfirm(null);
              }}
            >
              关闭
            </button>
            <button
              id="confirm-cancel"
              type="button"
              onClick={() => {
                confirm?.resolve(false);
                setConfirm(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
