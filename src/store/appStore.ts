import { create } from "zustand";
import type { ToolInfo } from "../api/tui";
import type { GroupState, PaneState } from "./types";

export type ToastItem = { groupId: string; label: string };

type AppStore = {
  tools: ToolInfo[];
  homeDir: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  groups: GroupState[];
  panes: Record<string, PaneState>;
  activeGroupId: string | null;
  focusedPaneId: string | null;
  windowFocused: boolean;
  toasts: ToastItem[];

  setTools: (tools: ToolInfo[]) => void;
  setHomeDir: (homeDir: string) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setWindowFocused: (focused: boolean) => void;

  upsertPane: (pane: PaneState) => void;
  updatePane: (id: string, patch: Partial<PaneState>) => void;
  removePane: (id: string) => void;

  upsertGroup: (group: GroupState) => void;
  updateGroup: (id: string, patch: Partial<GroupState>) => void;
  removeGroup: (id: string) => void;
  setGroups: (groups: GroupState[]) => void;

  setActive: (paneId: string) => void;
  setFocusedPaneId: (id: string | null) => void;
  setActiveGroupId: (id: string | null) => void;

  setUnread: (groupId: string, unread: boolean) => void;
  setBusy: (groupId: string, busy: boolean) => void;

  addToast: (toast: ToastItem) => void;
  removeToast: (groupId: string) => void;
  clearToasts: () => void;

  resetLayout: () => void;
};

export const useAppStore = create<AppStore>((set, get) => ({
  tools: [],
  homeDir: "",
  sidebarWidth: 160,
  sidebarCollapsed: false,
  groups: [],
  panes: {},
  activeGroupId: null,
  focusedPaneId: null,
  windowFocused: true,
  toasts: [],

  setTools: (tools) => set({ tools }),
  setHomeDir: (homeDir) => set({ homeDir }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setWindowFocused: (windowFocused) => set({ windowFocused }),

  upsertPane: (pane) =>
    set((s) => ({ panes: { ...s.panes, [pane.id]: pane } })),

  updatePane: (id, patch) =>
    set((s) => {
      const cur = s.panes[id];
      if (!cur) return s;
      return { panes: { ...s.panes, [id]: { ...cur, ...patch } } };
    }),

  removePane: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.panes;
      const groups = s.groups
        .map((g) => {
          if (!g.paneIds.includes(id)) return g;
          const paneIds = g.paneIds.filter((pid) => pid !== id);
          const focusId =
            g.focusId === id ? paneIds[0] || "" : g.focusId;
          return { ...g, paneIds, focusId };
        })
        .filter((g) => g.paneIds.length > 0);
      let focusedPaneId = s.focusedPaneId === id ? null : s.focusedPaneId;
      let activeGroupId = s.activeGroupId;
      if (focusedPaneId && !rest[focusedPaneId]) focusedPaneId = null;
      if (activeGroupId && !groups.some((g) => g.id === activeGroupId)) {
        activeGroupId = groups[0]?.id ?? null;
      }
      if (!focusedPaneId && activeGroupId) {
        const g = groups.find((x) => x.id === activeGroupId);
        focusedPaneId = g?.focusId || g?.paneIds[0] || null;
      }
      return {
        panes: rest,
        groups,
        focusedPaneId,
        activeGroupId,
        toasts: s.toasts.filter((t) => groups.some((g) => g.id === t.groupId)),
      };
    }),

  upsertGroup: (group) =>
    set((s) => {
      const idx = s.groups.findIndex((g) => g.id === group.id);
      if (idx === -1) return { groups: [...s.groups, group] };
      const groups = s.groups.slice();
      groups[idx] = group;
      return { groups };
    }),

  updateGroup: (id, patch) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),

  removeGroup: (id) =>
    set((s) => {
      const group = s.groups.find((g) => g.id === id);
      if (!group) return s;
      const panes = { ...s.panes };
      for (const pid of group.paneIds) delete panes[pid];
      const groups = s.groups.filter((g) => g.id !== id);
      let focusedPaneId = s.focusedPaneId;
      let activeGroupId = s.activeGroupId === id ? null : s.activeGroupId;
      if (focusedPaneId && !panes[focusedPaneId]) focusedPaneId = null;
      if (!activeGroupId && groups.length) {
        activeGroupId = groups[0].id;
        focusedPaneId = groups[0].focusId || groups[0].paneIds[0] || null;
      }
      return {
        panes,
        groups,
        focusedPaneId,
        activeGroupId,
        toasts: s.toasts.filter((t) => t.groupId !== id),
      };
    }),

  setGroups: (groups) => set({ groups }),

  setActive: (paneId) => {
    const s = get();
    const pane = s.panes[paneId];
    if (!pane) return;
    const group = s.groups.find((g) => g.paneIds.includes(paneId));
    if (!group) return;
    set({
      focusedPaneId: paneId,
      activeGroupId: group.id,
      groups: s.groups.map((g) =>
        g.id === group.id
          ? { ...g, focusId: paneId, unread: false }
          : g
      ),
      toasts: s.toasts.filter((t) => t.groupId !== group.id),
    });
  },

  setFocusedPaneId: (focusedPaneId) => set({ focusedPaneId }),
  setActiveGroupId: (activeGroupId) => set({ activeGroupId }),

  setUnread: (groupId, unread) =>
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId ? { ...g, unread } : g
      ),
    })),

  setBusy: (groupId, busy) =>
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId ? { ...g, busy } : g
      ),
    })),

  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts.filter((t) => t.groupId !== toast.groupId), toast],
    })),

  removeToast: (groupId) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.groupId !== groupId) })),

  clearToasts: () => set({ toasts: [] }),

  resetLayout: () =>
    set({
      groups: [],
      panes: {},
      activeGroupId: null,
      focusedPaneId: null,
      toasts: [],
    }),
}));

export function unreadGroupCount(state: {
  groups: GroupState[];
}): number {
  return state.groups.reduce((n, g) => n + (g.unread ? 1 : 0), 0);
}

export function folderName(cwd: string): string {
  const norm = String(cwd || "").replace(/[\\/]+$/, "");
  const parts = norm.split(/[/\\]/);
  return parts[parts.length - 1] || "home";
}

export function groupLabel(
  group: GroupState,
  panes: Record<string, PaneState>
): string {
  const custom = group.customTitle?.trim();
  if (custom) return custom;
  const cwd = panes[group.paneIds[0]]?.cwd || "";
  return folderName(cwd);
}

export function toolLabelForCli(
  cliId: string,
  tools: { id: string; label: string }[]
): string {
  return tools.find((t) => t.id === cliId)?.label || cliId || "?";
}

export function paneChromeText(
  cliId: string,
  cwd: string,
  tools: { id: string; label: string }[]
): string {
  return `${toolLabelForCli(cliId, tools)} \u00B7 ${cwd}`;
}
