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
  fileSystemPath,
  formatImageAttach,
  isImageFileName,
  isImageMime,
  parseClipboardImagePath,
} from "../lib/imageAttach";
import {
  looksLikeCliClearSubmit,
  pushCliClearBuffer,
} from "../lib/cliClearCommand";
import { shouldSuppressForImeComposition } from "../lib/imeCompositionKeys";
import {
  chatSubmitKeyAction,
  dataLooksLikeSubmit,
} from "../lib/continueDismissKeys";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function saveImageFile(file: File): Promise<string | null> {
  const existing = fileSystemPath(file);
  if (existing && (isImageFileName(existing) || isImageMime(file.type))) {
    return existing;
  }
  // Clipboard blobs may have empty name; trust image/* mime.
  if (!isImageMime(file.type) && !isImageFileName(file.name || "x.png")) {
    return null;
  }
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (!buf.length) return null;
    return await invoke<string>("save_image_bytes", {
      bytesB64: bytesToBase64(buf),
      filenameHint: file.name || "paste.png",
    });
  } catch {
    return null;
  }
}

async function clipboardReadForPaste(cliId?: string): Promise<string | null> {
  // 0) Native: file-path clipboard (Explorer/Finder copy) OR bitmap → path
  try {
    const path = await invoke<string>("clipboard_save_image");
    const attach = formatImageAttach(path, cliId);
    if (attach) return attach;
  } catch {
    /* no image / no file */
  }

  // 1) Chromium Clipboard API image blobs (screenshots in some WebViews)
  try {
    if (navigator.clipboard && "read" in navigator.clipboard) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = imageType.split("/")[1] || "png";
        const file = new File([blob], `paste.${ext}`, { type: imageType });
        const path = await saveImageFile(file);
        if (!path) continue;
        const attach = formatImageAttach(path, cliId);
        if (attach) return attach;
      }
    }
  } catch {
    /* permission / empty */
  }

  // 2) Plain text / Win "Copy as path" / Mac Option+Cmd+C
  try {
    const text = await readText();
    if (!text) return null;
    const path = parseClipboardImagePath(text);
    if (path) {
      const attach = formatImageAttach(path, cliId);
      if (attach) return attach;
    }
    return text;
  } catch {
    return null;
  }
}

async function pasteFromClipboardEvent(
  e: ClipboardEvent,
  cliId?: string
): Promise<string | null> {
  const items = e.clipboardData?.items;
  if (items?.length) {
    for (const item of Array.from(items)) {
      // Explorer paste: kind=file with local path on File
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (!file) continue;
        if (!isImageMime(file.type) && !isImageFileName(file.name)) continue;
        const path = await saveImageFile(file);
        if (!path) continue;
        const attach = formatImageAttach(path, cliId);
        if (attach) return attach;
      }
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const path = await saveImageFile(file);
        if (!path) continue;
        const attach = formatImageAttach(path, cliId);
        if (attach) return attach;
      }
    }
    // Absolute image path as text (Win/Mac) — else fall through to native
    // file-list reader; do not paste bare filenames and skip CF_HDROP / Finder URLs.
    const text = e.clipboardData?.getData("text");
    if (text) {
      const path = parseClipboardImagePath(text);
      if (path) {
        const attach = formatImageAttach(path, cliId);
        if (attach) return attach;
      }
    }
  }
  // Always prefer native file-list / bitmap when browser data was incomplete.
  return clipboardReadForPaste(cliId);
}

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
  /** auto | ask */
  approvalMode?: string;
  cliModels?: Record<string, string>;
};

export type ModelInfo = { id: string; label: string };
export type ModelsResult = {
  cliId: string;
  models: ModelInfo[];
  detail: string;
};
export type ProviderConfigView = {
  id: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  models: string[];
};
export type CliConfigView = {
  cliId: string;
  kind: string;
  configPath?: string | null;
  providers: ProviderConfigView[];
  detail: string;
  supportsKeyForm: boolean;
  supportsLogin: boolean;
};
export type ChatPermissionPayload = {
  requestId: string;
  permissionId: string;
  toolName: string;
  detail: string;
  cliId: string;
};

export type CreateResult = {
  id: string;
  label: string;
  canResume: boolean;
  cliSessionId?: string | null;
  knownBefore?: string[];
};

export type ResumeProbeResult = {
  canResume: boolean;
  knownBefore: string[];
};

export type DocArtifact = { path: string; label: string; mtimeMs?: number };
export type LinkArtifact = { url: string; label?: string };
export type ArtifactsResult = { docs: DocArtifact[]; links: LinkArtifact[] };

export type ChatSendResult = {
  requestId: string;
  ok: boolean;
  text: string;
  stderr: string;
  exitCode: number;
  needsAuth: boolean;
  timedOut: boolean;
  cancelled: boolean;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant" | string;
  text: string;
};

export type ChatHistoryResult = {
  sessionId?: string | null;
  messages: ChatHistoryMessage[];
};

export type ChatChunkPayload = {
  requestId: string;
  delta: string;
};

export type AuthStatus = {
  cliId: string;
  kind: string;
  loggedIn: boolean | null;
  detail: string;
  loginSupported: boolean;
};

export const CHAT_CLI_IDS = new Set([
  "claude",
  "opencode",
  "kimi",
  "cursor",
  "codex",
  "gemini",
  "pi",
]);

export function isChatCli(cliId: string): boolean {
  return CHAT_CLI_IDS.has(cliId);
}

export const tui = {
  isMac,
  isWin,
  createSession: (opts: { cwd?: string; cliId?: string }) =>
    invoke<CreateResult>("session_create", {
      cwd: opts.cwd,
      cliId: opts.cliId,
    }),
  probeResume: (opts: { cliId: string; cwd: string }) =>
    invoke<ResumeProbeResult>("session_probe_resume", {
      cliId: opts.cliId,
      cwd: opts.cwd,
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
  chatSend: (opts: {
    requestId: string;
    cliId: string;
    cwd: string;
    prompt: string;
    sessionId?: string | null;
    continueLast?: boolean;
    model?: string | null;
    approvalMode?: string | null;
  }) =>
    invoke<ChatSendResult>("chat_send", {
      requestId: opts.requestId,
      cliId: opts.cliId,
      cwd: opts.cwd,
      prompt: opts.prompt,
      sessionId: opts.sessionId ?? null,
      continueLast: opts.continueLast ?? false,
      model: opts.model ?? null,
      approvalMode: opts.approvalMode ?? null,
    }),
  chatPermissionReply: (opts: {
    requestId: string;
    permissionId: string;
    allow: boolean;
  }) =>
    invoke<void>("chat_permission_reply", {
      requestId: opts.requestId,
      permissionId: opts.permissionId,
      allow: opts.allow,
    }),
  chatCancel: (requestId: string) =>
    invoke<void>("chat_cancel", { requestId }),
  /** Prior turns from on-disk CLI session (after ↻). */
  chatHistory: (opts: {
    cliId: string;
    cwd: string;
    sessionId?: string | null;
  }) =>
    invoke<ChatHistoryResult>("chat_history", {
      cliId: opts.cliId,
      cwd: opts.cwd,
      sessionId: opts.sessionId ?? null,
    }),
  /** Await before chatSend so early chunks are not missed. */
  onChatChunk: (cb: (payload: ChatChunkPayload) => void) =>
    listen<ChatChunkPayload>("chat:chunk", (e) => cb(e.payload)),
  onChatPermission: (cb: (payload: ChatPermissionPayload) => void) =>
    listen<ChatPermissionPayload>("chat:permission", (e) => cb(e.payload)),
  cliModelsList: (cliId: string) =>
    invoke<ModelsResult>("cli_models_list", { cliId }),
  cliConfigGet: (cliId: string) =>
    invoke<CliConfigView>("cli_config_get", { cliId }),
  cliConfigSetProvider: (opts: {
    cliId: string;
    providerId: string;
    apiKey?: string | null;
    baseUrl?: string | null;
    modelIds?: string[] | null;
  }) =>
    invoke<CliConfigView>("cli_config_set_provider", {
      cliId: opts.cliId,
      providerId: opts.providerId,
      apiKey: opts.apiKey ?? null,
      baseUrl: opts.baseUrl ?? null,
      modelIds: opts.modelIds ?? null,
    }),
  cliConfigOpenDir: (cliId: string) =>
    invoke<string>("cli_config_open_dir", { cliId }),
  cliAuthStatus: (cliId: string) =>
    invoke<AuthStatus>("cli_auth_status", { cliId }),
  cliAuthLogin: (cliId: string, cwd?: string) =>
    invoke<void>("cli_auth_login", { cliId, cwd: cwd ?? null }),
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
  clipboardReadForPaste,
  pasteFromClipboardEvent,
  saveImageFile,
  formatImageAttach,
  parseClipboardImagePath,
  isImageFileName,
  isImageMime,
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
