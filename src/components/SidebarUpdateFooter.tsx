import type { UpdateUiState } from "../lib/useAppUpdater";
import { updateOfferTitle } from "../lib/useAppUpdater";

type Props = {
  updater: UpdateUiState;
};

function formatCurrentVersion(v: string): string {
  if (!v) return "…";
  return v.startsWith("v") || v.startsWith("V") ? v : `v${v}`;
}

/**
 * Sidebar bottom: current version (left) + plain clickable text (right).
 * Win + Mac shared; no modal / no chrome button.
 */
export default function SidebarUpdateFooter({ updater }: Props) {
  const {
    currentVersion,
    offer,
    busy,
    checking,
    checkFailed,
    upToDate,
    progress,
    error,
    canUpdate,
    install,
    recheck,
  } = updater;

  const versionLabel = formatCurrentVersion(currentVersion);
  const updating = busy;
  const showDownload = canUpdate && !!offer && !checkFailed && !updating && !checking;
  const showCheck = canUpdate && !updating && !checking && !showDownload;

  let actionTitle = "";
  if (updating && progress) {
    actionTitle =
      progress.label === "正在安装…"
        ? "正在安装并重启…"
        : `下载中 ${progress.label}`;
  } else if (checking) {
    actionTitle = "正在检查更新…";
  } else if (showDownload && offer) {
    actionTitle = updateOfferTitle(offer);
    if (error) actionTitle = `${actionTitle}\n\n上次失败：${error}`;
  } else if (checkFailed) {
    actionTitle = error
      ? `检查更新失败：${error}\n点击重试`
      : "检查更新失败，点击重试";
  } else if (upToDate) {
    actionTitle = "已是最新版本";
  } else if (showCheck) {
    actionTitle = "检查是否有新版本";
  } else if (!canUpdate) {
    actionTitle = "开发模式不检查更新";
  }

  const statusText = (() => {
    if (error && !updating && !checking) {
      return error.length > 36 ? `${error.slice(0, 36)}…` : error;
    }
    if (upToDate && !offer && !checkFailed) return "已是最新";
    return "";
  })();

  let actionLabel = "";
  let actionClass = "sidebar-update-action";
  let onActivate: (() => void) | null = null;
  let ariaLabel = "";

  if (updating) {
    actionLabel = "更新中...";
    actionClass += " is-busy";
    ariaLabel = actionTitle || "正在更新";
  } else if (checking) {
    actionLabel = "检查中...";
    actionClass += " is-busy";
    ariaLabel = "正在检查更新";
  } else if (showDownload) {
    actionLabel = "更新";
    actionClass += " is-clickable";
    onActivate = () => void install();
    ariaLabel = "下载并安装更新";
  } else if (showCheck) {
    actionLabel = "检查";
    actionClass += checkFailed ? " is-clickable is-failed" : " is-clickable";
    onActivate = () => void recheck();
    ariaLabel = checkFailed ? "重新检查更新" : "检查更新";
  }

  return (
    <div className="sidebar-update-footer" aria-label="应用版本与更新">
      <div className="sidebar-update-meta">
        <span className="sidebar-update-version" title={`SeMa ${versionLabel}`}>
          {versionLabel}
        </span>
        {statusText ? (
          <span
            className={`sidebar-update-status${error && !updating && !checking ? " is-error" : ""}`}
            title={error && !updating && !checking ? error : statusText}
            role="status"
          >
            {statusText}
          </span>
        ) : null}
      </div>
      {actionLabel ? (
        <span
          className={actionClass}
          title={actionTitle || undefined}
          role={onActivate ? "button" : "status"}
          tabIndex={onActivate ? 0 : undefined}
          aria-label={ariaLabel}
          aria-busy={updating || checking}
          onClick={onActivate ?? undefined}
          onKeyDown={
            onActivate
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onActivate();
                  }
                }
              : undefined
          }
        >
          {actionLabel}
        </span>
      ) : null}
    </div>
  );
}
