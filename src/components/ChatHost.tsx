import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  tui,
  type AuthStatus,
  type ChatPermissionPayload,
  type ChatSendResult,
  type ModelInfo,
} from "../api/tui";
import {
  fetchAuthStatus,
  getCachedAuth,
  invalidateAuthCache,
} from "../lib/cliAuthCache";
import {
  fetchModelsList,
  getCachedModels,
} from "../lib/cliModelsCache";
import { syncChatPreHScroll } from "../lib/chatPreHScroll";
import { renderMarkdown } from "../lib/markdown";
import { useAppStore } from "../store/appStore";
import ChromeVScrollbar from "./ChromeVScrollbar";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "divider";
  text: string;
};

type Props = {
  paneId: string;
  cliId: string;
  cwd: string;
  cliSessionId?: string | null;
  /** After ↻: next send continues last / bound session. */
  resumeArmed?: boolean;
  visible: boolean;
  model?: string;
  approvalMode?: string;
  onModelChange?: (model: string) => void;
  onSubmitChat: () => void;
  onBusy?: (busy: boolean) => void;
  /** Drive tab green pulse / unread toast (same path as PTY noteActivity). */
  onActivityData?: (data: string) => void;
  /** After send settles: ensure idle timer so unread/toast still fire. */
  onActivitySettle?: () => void;
  onCliSessionHint?: (cliSessionId: string | null) => void;
  onResumeConsumed?: () => void;
};

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m-${Date.now()}-${msgSeq}`;
}

export default function ChatHost({
  paneId,
  cliId,
  cwd,
  cliSessionId,
  resumeArmed,
  visible,
  model,
  approvalMode,
  onModelChange,
  onSubmitChat,
  onBusy,
  onActivityData,
  onActivitySettle,
  onCliSessionHint,
  onResumeConsumed,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authBanner, setAuthBanner] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>(
    () => getCachedModels(cliId) || []
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [perm, setPerm] = useState<ChatPermissionPayload | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const modelFieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRequestId = useRef<string | null>(null);
  // Stable refs so in-flight stream listeners always hit the latest App handlers.
  const activityRef = useRef({
    onActivityData,
    onActivitySettle,
    onSubmitChat,
  });
  activityRef.current = { onActivityData, onActivitySettle, onSubmitChat };

  const refreshAuth = useCallback(
    (opts?: { force?: boolean }) => {
      if (opts?.force) invalidateAuthCache(cliId);
      const cached = !opts?.force ? getCachedAuth(cliId) : null;
      if (cached) {
        setAuth(cached);
        if (cached.loggedIn === false) setAuthBanner(true);
        if (cached.loggedIn === true) setAuthBanner(false);
        return;
      }
      void fetchAuthStatus(cliId)
        .then((s) => {
          setAuth(s);
          if (s.loggedIn === false) setAuthBanner(true);
          if (s.loggedIn === true) setAuthBanner(false);
        })
        .catch(() => {
          /* ignore */
        });
    },
    [cliId]
  );

  // Do NOT probe on every mount — layout restore mounts all panes; each
  // `status`/`auth` spawn is multi-second and freezes startup.
  useEffect(() => {
    if (!visible) return;
    refreshAuth();
  }, [visible, refreshAuth]);

  useEffect(() => {
    const cached = getCachedModels(cliId);
    if (cached) setModels(cached);
    if (!visible) return;
    let cancelled = false;
    void fetchModelsList(cliId).then((list) => {
      if (!cancelled) setModels(list);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, cliId]);

  useEffect(() => {
    if (!visible) return;
    const el = listRef.current;
    if (!el) return;
    // Don't yank the viewport while the user scrolled up (or is dragging the bar).
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (fromBottom > 96) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, visible, sending, perm]);

  // Wide ``` fences: custom chrome h-scrollbar (native bars fail in WebView).
  useLayoutEffect(() => {
    if (!visible) return;
    const root = listRef.current;
    if (!root) return;
    let dispose = syncChatPreHScroll(root);
    const resync = () => {
      dispose();
      dispose = syncChatPreHScroll(root);
    };
    const t1 = window.setTimeout(resync, 80);
    const t2 = window.setTimeout(resync, 300);
    return () => {
      dispose();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [messages, visible, sending, streamStarted]);

  useEffect(() => {
    if (visible) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible, paneId]);

  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!modelFieldRef.current?.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  useEffect(() => {
    if (sending) setModelOpen(false);
  }, [sending]);

  // ↻ armed: load on-disk history into bubbles, then a short resume note.
  useEffect(() => {
    if (!resumeArmed) return;
    let cancelled = false;
    const paneNow = useAppStore.getState().panes[paneId];
    const sid = (paneNow?.cliSessionId ?? cliSessionId)?.trim() || null;
    void tui
      .chatHistory({ cliId, cwd, sessionId: sid })
      .then((r) => {
        if (cancelled) return;
        const hist = (r.messages || [])
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              String(m.text || "").trim()
          )
          .map((m) => ({
            id: nextId(),
            role: (m.role === "user" ? "user" : "assistant") as ChatMessage["role"],
            text: String(m.text),
          }));
        if (r.sessionId && r.sessionId !== sid) {
          onCliSessionHint?.(r.sessionId);
        }
        if (hist.length) {
          setMessages([
            ...hist,
            {
              id: nextId(),
              role: "divider",
              text: "以上为历史对话，发送消息以继续",
            },
          ]);
        } else {
          setMessages((prev) => {
            if (
              prev.some(
                (m) => m.role === "system" && m.text.startsWith("已准备继续")
              )
            ) {
              return prev;
            }
            return [
              ...prev,
              {
                id: nextId(),
                role: "system",
                text: "已准备继续上次会话，发送一条消息即可接上。",
              },
            ];
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessages((prev) => {
          if (prev.some((m) => m.role === "system" && m.text.startsWith("已准备继续"))) {
            return prev;
          }
          return [
            ...prev,
            {
              id: nextId(),
              role: "system",
              text: "已准备继续上次会话，发送一条消息即可接上。",
            },
          ];
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resumeArmed, cliId, cwd, cliSessionId, paneId, onCliSessionHint]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
    setSending(true);
    setStreamStarted(false);
    onBusy?.(true);
    activityRef.current.onSubmitChat();

    const requestId = nextId();
    const assistantId = nextId();
    activeRequestId.current = requestId;
    let gotChunk = false;
    let stopListen: (() => void) | undefined;
    let stopPerm: (() => void) | undefined;

    // Read store at send-time — ↻ may have just written cliSessionId / armed
    // before this pane re-rendered.
    const paneNow = useAppStore.getState().panes[paneId];
    const sessionId =
      (paneNow?.cliSessionId ?? cliSessionId)?.trim() || null;
    const armed = !!(paneNow?.chatResumeArmed ?? resumeArmed);
    const priorTurns = messages.some(
      (m) => m.role === "assistant" || m.role === "user"
    );
    // Resume: bound id wins; else ↻ / in-thread multi-turn without id yet.
    const continueLast = !sessionId && (armed || priorTurns);
    try {
      stopListen = await tui.onChatChunk((payload) => {
        if (payload.requestId !== requestId) return;
        const delta = payload.delta ?? "";
        if (!delta) return;
        activityRef.current.onActivityData?.(delta);
        if (!gotChunk) {
          gotChunk = true;
          setStreamStarted(true);
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", text: delta },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: m.text + delta } : m
            )
          );
        }
      });
      stopPerm = await tui.onChatPermission((payload) => {
        if (payload.requestId !== requestId) return;
        setPerm(payload);
      });

      const result: ChatSendResult = await tui.chatSend({
        requestId,
        cliId,
        cwd,
        prompt: text,
        sessionId,
        continueLast,
        model: model || null,
        approvalMode: approvalMode || null,
      });
      if (armed) onResumeConsumed?.();

      if (result.cancelled) {
        // Keep any streamed text; drop empty assistant placeholder — no "[Stopped]".
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || !!m.text.trim())
        );
        return;
      }

      if (result.needsAuth) {
        setAuthBanner(true);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== assistantId),
          {
            id: nextId(),
            role: "system",
            text: "需要登录后才能继续。请点击下方「登录」，完成浏览器授权后再发送。",
          },
        ]);
        refreshAuth();
        return;
      }

      const reply =
        result.text?.trim() ||
        result.stderr?.trim() ||
        (result.ok ? "(空回复)" : `失败（exit ${result.exitCode}）`);

      // Non-streaming CLIs: one shot of text — still refresh idle via activity.
      if (!gotChunk && reply) activityRef.current.onActivityData?.(reply);

      setMessages((prev) => {
        const has = prev.some((m) => m.id === assistantId);
        if (has) {
          // Prefer streamed text; if empty stream, fill from final result.
          return prev.map((m) =>
            m.id === assistantId && !m.text.trim() ? { ...m, text: reply } : m
          );
        }
        return [...prev, { id: assistantId, role: "assistant", text: reply }];
      });

      void tui
        .discoverCliSession({ cliId, cwd, sessionId: paneId })
        .then((r) => {
          if (r.cliSessionId) onCliSessionHint?.(r.cliSessionId);
        })
        .catch(() => {
          /* ignore */
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel|stopp?ed|killed/i.test(msg)) {
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || !!m.text.trim())
        );
      } else {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== assistantId),
          { id: nextId(), role: "system", text: msg || "Send failed" },
        ]);
      }
    } finally {
      stopListen?.();
      stopPerm?.();
      setPerm(null);
      activeRequestId.current = null;
      setSending(false);
      setStreamStarted(false);
      onBusy?.(false);
      // Kick idle clock — unread toast depends on markGroupIdle after settle.
      activityRef.current.onActivitySettle?.();
    }
  }, [
    draft,
    sending,
    messages,
    cliId,
    cwd,
    cliSessionId,
    resumeArmed,
    model,
    approvalMode,
    paneId,
    onBusy,
    onResumeConsumed,
    onCliSessionHint,
    refreshAuth,
  ]);

  const onLogin = () => {
    void tui
      .cliAuthLogin(cliId, cwd)
      .then(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "system",
            text: "已打开登录流程（通常会弹出浏览器）。完成后点「刷新状态」或直接再发一条消息。",
          },
        ]);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "system", text: msg || "无法启动登录" },
        ]);
      });
  };

  const replyPerm = (allow: boolean) => {
    if (!perm) return;
    const cur = perm;
    setPerm(null);
    void tui
      .chatPermissionReply({
        requestId: cur.requestId,
        permissionId: cur.permissionId,
        allow,
      })
      .catch(() => {
        /* ignore */
      });
  };

  const stop = () => {
    const id = activeRequestId.current;
    if (!id) return;
    // Fire-and-forget; backend marks cancelled + kills without blocking.
    void tui.chatCancel(id).catch(() => {
      /* ignore */
    });
  };

  return (
    <div className={`chat-host${visible ? " visible" : ""}`}>
      {authBanner || auth?.loggedIn === false ? (
        <div className="chat-auth-banner" role="status">
          <span>
            {auth?.loginSupported
              ? "当前引擎可能未登录。"
              : "当前引擎需要本机已配置的凭据（API Key 等）。"}
          </span>
          <div className="chat-auth-actions">
            {auth?.loginSupported ? (
              <button type="button" onClick={onLogin}>
                登录
              </button>
            ) : null}
            <button type="button" onClick={() => refreshAuth({ force: true })}>
              刷新状态
            </button>
          </div>
        </div>
      ) : null}
      {perm ? (
        <div className="chat-perm-card" role="alertdialog">
          <div className="chat-perm-title">
            Tool approval · {perm.toolName || "tool"}
          </div>
          <pre className="chat-perm-detail">{perm.detail || perm.permissionId}</pre>
          <div className="chat-perm-actions">
            <button type="button" onClick={() => replyPerm(true)}>
              Allow
            </button>
            <button type="button" className="danger" onClick={() => replyPerm(false)}>
              Deny
            </button>
          </div>
        </div>
      ) : null}
      <div className="chat-messages-shell chrome-vscroll-shell">
        <div className="chat-messages chrome-vscroll-port" ref={listRef}>
          {messages.map((m) =>
            m.role === "divider" ? (
              <div key={m.id} className="chat-divider" role="separator">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`chat-bubble chat-${m.role}`}>
                <div className="chat-bubble-role">
                  {m.role === "user"
                    ? "You"
                    : m.role === "assistant"
                      ? "Assistant"
                      : "System"}
                </div>
                {m.role === "assistant" ? (
                  <div
                    className="chat-bubble-text chat-md pane-doc-sandbox"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(m.text),
                    }}
                  />
                ) : (
                  <pre className="chat-bubble-text">{m.text}</pre>
                )}
              </div>
            )
          )}
          {sending && !streamStarted ? (
            <div
              className="chat-bubble chat-assistant chat-pending"
              aria-busy="true"
            >
              <div className="chat-typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
        </div>
        <ChromeVScrollbar
          scrollRef={listRef}
          layoutKey={`${messages.length}-${sending}-${streamStarted}-${perm?.permissionId || ""}`}
        />
      </div>
      <div className="chat-footer">
        <div className="chat-toolbar">
          <div className="chat-model-field" ref={modelFieldRef}>
            <span>Model</span>
            {models.length ? (
              <div className="chat-model-picker">
                <button
                  type="button"
                  className="chat-model-trigger"
                  disabled={sending}
                  aria-expanded={modelOpen}
                  aria-haspopup="listbox"
                  onClick={() => setModelOpen((o) => !o)}
                >
                  <span className="chat-model-trigger-label">
                    {models.find((m) => m.id === model)?.label ||
                      model ||
                      "Default"}
                  </span>
                  <span className="chat-model-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {modelOpen ? (
                  <div className="chat-model-menu chrome-vscroll-shell">
                    <div
                      className="chat-model-menu-list chrome-vscroll-port"
                      ref={modelListRef}
                      role="listbox"
                    >
                      <button
                        type="button"
                        role="option"
                        className={`chat-model-option${!model ? " is-active" : ""}`}
                        aria-selected={!model}
                        onClick={() => {
                          onModelChange?.("");
                          setModelOpen(false);
                        }}
                      >
                        Default
                      </button>
                      {models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          className={`chat-model-option${
                            model === m.id ? " is-active" : ""
                          }`}
                          aria-selected={model === m.id}
                          onClick={() => {
                            onModelChange?.(m.id);
                            setModelOpen(false);
                          }}
                        >
                          {m.label || m.id}
                        </button>
                      ))}
                    </div>
                    <ChromeVScrollbar
                      scrollRef={modelListRef}
                      layoutKey={`models-${models.length}-${modelOpen}`}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <input
                value={model || ""}
                disabled={sending}
                placeholder="model id"
                onChange={(e) => onModelChange?.(e.target.value)}
              />
            )}
          </div>
          <span className="chat-approval-tag" title="Change in Settings">
            Approval: {approvalMode === "ask" ? "Ask" : "Auto"}
          </span>
        </div>
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={3}
            value={draft}
            placeholder="Message… Enter to send, Shift+Enter for newline"
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {sending ? (
            <button
              type="button"
              className="chat-stop"
              title="Stop"
              onClick={() => stop()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              disabled={!draft.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
