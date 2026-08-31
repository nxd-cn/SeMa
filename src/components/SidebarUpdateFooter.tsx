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
 * Sidebar bottom: current version (left) + update/refresh action (right).
 * Win + Mac shared; no modal.
 */
export default function SidebarUpdateFooter({ updater }: Props) {
  const {
    currentVersion,
    offer,
    busy,
    checking,
    checkFailed,
    progress,
    error,
    install,
    recheck,
  } = updater;

  const versionLabel = formatCurrentVersion(currentVersion);
  const showDownload = !!offer && !checkFailed;
  const showRefresh = checkFailed && !busy;

  let actionTitle = "";
  if (busy && progress) {
    actionTitle = progress.label === "正在安装…" ? "正在安装并重启…" : `下载中 ${progress.label}`;
  } else if (showDownload && offer) {
    actionTitle = updateOfferTitle(offer);
    if (error) actionTitle = `${actionTitle}\n\n上次失败：${error}`;
  } else if (showRefresh) {
    actionTitle = checking
      ? "正在检查更新…"
      : "检查更新失败，点击重试";
  } else if (checking) {
    actionTitle = "正在检查更新…";
  }

  return (
    <div className="sidebar-update-footer" aria-label="应用版本与更新">
      <span className="sidebar-update-version" title={`SeMa ${versionLabel}`}>
        {versionLabel}
      </span>
      <div className="sidebar-update-actions">
        {busy && progress ? (
          <span
            className="sidebar-update-progress"
            title={actionTitle}
            role="status"
          >
            {progress.percent != null ? (
              <>
                <span className="sidebar-update-progress-bar" aria-hidden="true">
                  <span
                    className="sidebar-update-progress-fill"
                    style={{ width: `${progress.percent}%` }}
                  />
                </span>
                <span className="sidebar-update-progress-text">
                  {progress.label}
                </span>
              </>
            ) : (
              <span className="sidebar-update-progress-text">
                {progress.label}
              </span>
            )}
          </span>
        ) : showDownload ? (
          <button
            type="button"
            className="sidebar-update-btn"
            title={actionTitle}
            aria-label="下载并安装更新"
            disabled={checking}
            onClick={() => void install()}
          >
            更新
          </button>
        ) : showRefresh ? (
          <button
            type="button"
            className={`sidebar-update-btn${checking ? " is-checking" : ""}`}
            title={actionTitle}
            aria-label="重新检查更新"
            disabled={checking}
            onClick={() => void recheck()}
          >
            更新
          </button>
        ) : null}
      </div>
    </div>
  );
}
