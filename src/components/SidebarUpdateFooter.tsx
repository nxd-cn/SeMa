import type { UpdateUiState } from "../lib/useAppUpdater";
import { updateOfferTitle } from "../lib/useAppUpdater";

type Props = {
  updater: UpdateUiState;
};

function DownloadIcon() {
  return (
    <svg
      className="sidebar-update-icon-svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 1.5a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5Z"
      />
      <path
        fill="currentColor"
        d="M2.5 11.25a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1-.75-.75Z"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      className="sidebar-update-icon-svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 2.5a5.5 5.5 0 0 0-4.6 2.45.75.75 0 1 1-1.25-.83A7 7 0 0 1 14.5 8h1.06a.75.75 0 0 1 .53 1.28l-1.75 1.75a.75.75 0 0 1-1.06 0l-1.75-1.75A.75.75 0 0 1 12.06 8H13a5.5 5.5 0 1 0-5 5.48.75.75 0 0 1 .14 1.5A7 7 0 1 1 8 2.5Z"
      />
    </svg>
  );
}

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
            <DownloadIcon />
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
            <RefreshIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}
