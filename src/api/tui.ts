import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  clipboardAction,
  selectionDeleteAction,
  selectionDeletePayload,
  lineClearAction,
  LINE_CLEAR_PAYLOAD,
  undoAction,
  UNDO_PAYLOAD,
} from "../lib/clipboardKeys";
import {
  looksLikeCliClearSubmit,
  pushCliClearBuffer,
} from "../lib/cliClearCommand";
import { shouldSuppressForImeComposition } from "../lib/imeCompositionKeys";
import {
  chatSubmitKeyAction,
  dataLooksLikeSubmit,
} from "../lib/continueDismissKeys";

const isMac = navigator.userAgent.includes("Mac");
const isWin = navigator.userAgent.includes("Windows");

export type ToolInfo = {
  id: string;
  label: string;
  command: string;
  path: string;
};

export type Prefs = {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  last: { cwd: string; cliId: string } | null;
  cliCounts: Record<string, number>;
  split: unknown;
  layout: unknown;
  homeDir: string;
  docFontSize?: number;
  termFontSize?: number;
};

export type CreateResult = {
  id: string;
  label: string;
  canResume: boolean;
  cliSessionId?: string | null;
  knownBefore?: string[];
};

export type DocArtifact = { path: string; label: string; mtimeMs?: number };
export type LinkArtifact = { url: string; label?: string };
export type ArtifactsResult = { docs: DocArtifact[]; links: LinkArtifact[] };

export const tui = {
  isMac,
  isWin,
  createSession: (opts: { cwd?: string; cliId?: string }) =>
    invoke<CreateResult>("session_create", {
      cwd: opts.cwd,
      cliId: opts.cliId,
    }),
  respawnSession: (opts: {
    id: string;
    cwd?: string;
    cliId: string;
    cliSessionId?: string | null;
    excludeIds?: string[];
    cols?: number;
    rows?: number;
  }) =>
    invoke<{
      ok: boolean;
      usedBound: boolean;
      cliSessionId?: string | null;
      fallback?: boolean;
    }>("session_respawn", {
      id: opts.id,
      cwd: opts.cwd,
      cliId: opts.cliId,
      cliSessionId: opts.cliSessionId ?? null,
      excludeIds: opts.excludeIds ?? null,
      cols: opts.cols ?? null,
      rows: opts.rows ?? null,
    }),
  discoverCliSession: (opts: {
    cliId: string;
    cwd: string;
    sessionId?: string;
    excludeIds?: string[];
  }) =>
    invoke<{ cliSessionId: string | null }>("session_discover_cli_session", {
      cliId: opts.cliId,
      cwd: opts.cwd,
      sessionId: opts.sessionId ?? null,
      excludeIds: opts.excludeIds ?? null,
    }),
  /** After /clear etc.: if a newer unbound session exists, return it. */
  followCliSession: (opts: {
    cliId: string;
    cwd: string;
    currentId: string;
    sessionId?: string;
    excludeIds?: string[];
    /** 0 = single check; omit = poll up to 25s after submit. */
    timeoutMs?: number;
  }) =>
    invoke<{ cliSessionId: string | null }>("session_follow_cli_session", {
      cliId: opts.cliId,
      cwd: opts.cwd,
      currentId: opts.currentId,
      sessionId: opts.sessionId ?? null,
      excludeIds: opts.excludeIds ?? null,
      timeoutMs: opts.timeoutMs ?? null,
    }),
  killSession: (id: string) => invoke<void>("session_kill", { id }),
  write: (id: string, data: string) =>
    invoke<void>("session_write", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { id, cols, rows }),
  listCli: () => invoke<{ tools: ToolInfo[] }>("cli_list"),
  pickFolder: () =>
    invoke<{ canceled: boolean; path?: string }>("dialog_pick_folder"),
  getPrefs: () => invoke<Prefs>("prefs_get"),
  setPrefs: (partial: Record<string, unknown>) =>
    invoke<Prefs>("prefs_set", { partial }),
  focusWindow: () => invoke<void>("window_focus"),
  setUnreadBadge: (count: number) =>
    invoke<void>("badge_set", { count: Number(count) || 0 }),
  sessionArtifacts: (args: {
    cliId: string;
    cwd: string;
    cliSessionId?: string | null;
    sinceSeq?: number | null;
  }) =>
    invoke<ArtifactsResult>("session_artifacts", {
      cliId: args.cliId,
      cwd: args.cwd,
      cliSessionId: args.cliSessionId ?? null,
      sinceSeq: args.sinceSeq ?? null,
    }).catch(() => ({ docs: [], links: [] })),
  sessionArtifactsSeq: (args: {
    cliId: string;
    cwd: string;
    cliSessionId?: string | null;
  }) =>
    invoke<number>("session_artifacts_seq", {
      cliId: args.cliId,
      cwd: args.cwd,
      cliSessionId: args.cliSessionId ?? null,
    }).catch(() => 0),
  openExternal: (target: string) =>
    invoke<void>("open_external", { target }),
  /** Open a directory in Finder (macOS) / Explorer (Windows). */
  openPath: (path: string) => invoke<void>("open_path", { path }),
  readTextFile: (args: { path: string; maxBytes?: number }) =>
    invoke<string>("read_text_file", {
      path: args.path,
      maxBytes: args.maxBytes ?? null,
    }),
  writeTextFile: (args: { path: string; contents: string }) =>
    invoke<void>("write_text_file", {
      path: args.path,
      contents: args.contents,
    }),
  paneWebviewOpen: (args: {
    id: string;
    url: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }) => invoke<void>("pane_webview_open", args),
  paneWebviewSetBounds: (args: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }) => invoke<void>("pane_webview_set_bounds", args),
  paneWebviewSetVisible: (args: { id: string; visible: boolean }) =>
    invoke<void>("pane_webview_set_visible", args),
  paneWebviewSetHitTest: (args: { id: string; hitTest: boolean }) =>
    invoke<void>("pane_webview_set_hit_test", { id: args.id, hit_test: args.hitTest }),
  paneWebviewClose: (id: string) =>
    invoke<void>("pane_webview_close", { id }),
  /** Current git branch for cwd, or `~` when not a repo / git missing / errors. */
  gitBranch: async (cwd: string) => {
    try {
      const name = await invoke<string>("git_branch", { cwd });
      const text = String(name ?? "").trim();
      return text || "~";
    } catch {
      return "~";
    }
  },
  clipboardRead: () => readText(),
  clipboardWrite: (text: string) => writeText(String(text ?? "")),
  clipboardAction: (ev: KeyboardEvent, hasSelection: boolean) =>
    clipboardAction(ev, { hasSelection: !!hasSelection, isMac }),
  selectionDeleteAction: (ev: KeyboardEvent, hasSelection: boolean) =>
    selectionDeleteAction(ev, { hasSelection: !!hasSelection }),
  selectionDeletePayload,
  lineClearAction,
  LINE_CLEAR_PAYLOAD,
  undoAction: (ev: KeyboardEvent) => undoAction(ev, { isMac }),
  UNDO_PAYLOAD,
  shouldSuppressForImeComposition,
  chatSubmitKeyAction,
  dataLooksLikeSubmit,
  looksLikeCliClearSubmit,
  pushCliClearBuffer,
  onData: (cb: (payload: { id: string; data: string }) => void): (() => void) => {
    let un: UnlistenFn | undefined;
    void listen<{ id: string; data: string }>("session:data", (e) =>
      cb(e.payload)
    ).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  },
  onExit: (cb: (payload: { id: string; exitCode: number }) => void): (() => void) => {
    let un: UnlistenFn | undefined;
    void listen<{ id: string; exitCode: number }>("session:exit", (e) =>
      cb(e.payload)
    ).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  },
};
