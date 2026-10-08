import { useEffect, useRef, useState } from "react";
import {
  CHAT_CLI_IDS,
  tui,
  type AuthStatus,
  type CliConfigView,
  type ModelInfo,
  type ToolInfo,
} from "../api/tui";
import { invalidateAuthCache } from "../lib/cliAuthCache";
import { fetchModelsList } from "../lib/cliModelsCache";
import ChromeVScrollbar from "./ChromeVScrollbar";

type Props = {
  open: boolean;
  onClose: () => void;
  tools: ToolInfo[];
  approvalMode: string;
  cliModels: Record<string, string>;
  onSaved: (patch: {
    approvalMode?: string;
    cliModels?: Record<string, string>;
  }) => void;
};

const CLI_LABELS: Record<string, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  kimi: "Kimi Code",
  cursor: "Cursor Agent",
  codex: "Codex",
  gemini: "Gemini",
  pi: "Pi",
};

export default function SettingsModal({
  open,
  onClose,
  tools,
  approvalMode,
  cliModels,
  onSaved,
}: Props) {
  const chatTools = tools.filter((t) => CHAT_CLI_IDS.has(t.id));
  const [cliId, setCliId] = useState(chatTools[0]?.id || "claude");
  const [approval, setApproval] = useState(approvalMode || "auto");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [config, setConfig] = useState<CliConfigView | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [providerId, setProviderId] = useState("custom");
  const [apiKey, setApiKey] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setApproval(approvalMode || "auto");
  }, [open, approvalMode]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMsg("");
    setBusy(true);
    void (async () => {
      try {
        const [cfg, authSt, modelsList] = await Promise.all([
          tui.cliConfigGet(cliId),
          tui.cliAuthStatus(cliId).catch(() => null),
          fetchModelsList(cliId),
        ]);
        if (cancelled) return;
        setConfig(cfg);
        setAuth(authSt);
        setModels(modelsList);
        setModelId(cliModels[cliId] || "");
        const first = cfg.providers[0];
        if (first) {
          setProviderId(first.id);
          setBaseUrl(first.baseUrl || "");
          setApiKey("");
        } else {
          setProviderId(cliId === "pi" ? "default" : "custom");
          setBaseUrl("");
          setApiKey("");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cliId, cliModels]);

  if (!open) return null;

  const saveApprovalAndModel = async () => {
    setBusy(true);
    setMsg("");
    try {
      const nextModels = { ...cliModels };
      if (modelId.trim()) nextModels[cliId] = modelId.trim();
      else delete nextModels[cliId];
      await tui.setPrefs({
        approvalMode: approval,
        cliModels: nextModels,
      });
      onSaved({ approvalMode: approval, cliModels: nextModels });
      setMsg("已保存审批模式与默认模型");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveProvider = async () => {
    setBusy(true);
    setMsg("");
    try {
      const view = await tui.cliConfigSetProvider({
        cliId,
        providerId: providerId.trim() || "custom",
        apiKey: apiKey.trim() || null,
        baseUrl: baseUrl.trim() || null,
        modelIds: modelId.trim() ? [modelId.trim()] : null,
      });
      setConfig(view);
      setApiKey("");
      setMsg("已写入引擎配置（Key 仅保存在 CLI 配置文件）");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-label="SeMa 设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <strong>设置</strong>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-body-shell chrome-vscroll-shell">
        <div className="settings-body chrome-vscroll-port" ref={bodyRef}>
          <label className="settings-field">
            <span>工具审批</span>
            <select
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
            >
              <option value="auto">自动批准（推荐 headless）</option>
              <option value="ask">每次确认（Claude 等支持协议时）</option>
            </select>
          </label>
          <p className="settings-hint">
            Ask 模式：去掉各 CLI 的 yolo/force/auto；Claude 走
            permission-prompts=host，弹出审批卡片。其它引擎若无协议可能卡住，请改回自动。
          </p>

          <label className="settings-field">
            <span>引擎</span>
            <select value={cliId} onChange={(e) => setCliId(e.target.value)}>
              {(chatTools.length ? chatTools : [...CHAT_CLI_IDS].map((id) => ({ id, label: CLI_LABELS[id] || id }))).map(
                (t) => (
                  <option key={t.id} value={t.id}>
                    {"label" in t && t.label ? t.label : CLI_LABELS[t.id] || t.id}
                  </option>
                )
              )}
            </select>
          </label>

          <div className="settings-section">
            <div className="settings-section-title">鉴权</div>
            <p className="settings-hint">
              {auth
                ? `状态：${
                    auth.loggedIn === true
                      ? "已登录"
                      : auth.loggedIn === false
                        ? "未登录"
                        : "未知"
                  } · ${auth.kind}${auth.detail ? ` · ${auth.detail.slice(0, 80)}` : ""}`
                : config?.detail || "—"}
            </p>
            <div className="settings-row">
              {config?.supportsLogin || auth?.loginSupported ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void tui.cliAuthLogin(cliId).then(() => {
                      invalidateAuthCache(cliId);
                      setMsg("已打开登录流程，完成后点刷新");
                    });
                  }}
                >
                  登录
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  invalidateAuthCache(cliId);
                  void tui.cliAuthStatus(cliId).then(setAuth);
                }}
              >
                刷新状态
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void tui.cliConfigOpenDir(cliId).then((dir) =>
                    tui.openPath(dir)
                  );
                }}
              >
                打开配置目录
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">默认模型</div>
            <label className="settings-field">
              <span>模型</span>
              {models.length ? (
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  <option value="">（引擎默认）</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={modelId}
                  placeholder="手动填写 model id"
                  onChange={(e) => setModelId(e.target.value)}
                />
              )}
            </label>
          </div>

          {config?.supportsKeyForm ? (
            <div className="settings-section">
              <div className="settings-section-title">厂商 / Key（写入引擎配置）</div>
              <label className="settings-field">
                <span>Provider id</span>
                <input
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Base URL</span>
                <input
                  value={baseUrl}
                  placeholder="https://…"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder={
                    config.providers[0]?.hasApiKey
                      ? `已保存 ${config.providers[0].apiKeyHint}（留空不改）`
                      : "不会显示在 SeMa prefs"
                  }
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button type="button" disabled={busy} onClick={() => void saveProvider()}>
                写入 {CLI_LABELS[cliId] || cliId} 配置
              </button>
            </div>
          ) : (
            <p className="settings-hint">
              此引擎不走 Key 表单（账号登录或环境变量）。可用上方登录 / 打开配置目录。
            </p>
          )}

          {msg ? <p className="settings-msg">{msg}</p> : null}
        </div>
        <ChromeVScrollbar
          scrollRef={bodyRef}
          layoutKey={`settings-${cliId}-${models.length}-${open}`}
        />
        </div>
        <div className="settings-footer">
          <button type="button" disabled={busy} onClick={() => void saveApprovalAndModel()}>
            保存
          </button>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
