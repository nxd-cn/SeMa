import { useEffect, useState } from "react";
import { tui } from "../api/tui";
import { paneChromeText, toolLabelForCli, useAppStore } from "../store/appStore";
import type { PaneState } from "../store/types";
import TerminalHost, { type TermHandle } from "./TerminalHost";

const BRANCH_FALLBACK = "~";
/** Refresh while visible so external checkouts show up without restart. */
const BRANCH_POLL_MS = 8000;

type Props = {
  pane: PaneState;
  visible: boolean;
  showDetach: boolean;
  onFocus: () => void;
  onClose: () => void;
  onDetach: () => void;
  onContinue: () => void;
  onSubmitChat: () => void;
  onCliSessionCleared?: () => void;
  onActivityData: (data: string) => void;
  onContextMenu: (
    clientX: number,
    clientY: number,
    hasSelection: boolean
  ) => void;
  onExit: () => void;
  onTermReady: (handle: TermHandle | null) => void;
  flex: number;
};

export default function Pane({
  pane,
  visible,
  showDetach,
  onFocus,
  onClose,
  onDetach,
  onContinue,
  onSubmitChat,
  onCliSessionCleared,
  onActivityData,
  onContextMenu,
  onExit,
  onTermReady,
  flex,
}: Props) {
  const tools = useAppStore((s) => s.tools);
  const toolLabel = toolLabelForCli(pane.cliId, tools);
  const chromeText = paneChromeText(pane.cliId, pane.cwd, tools);

  // ↻ while resume offer is pending (canResume or layout-bound id); hide after dismiss.
  const showContinue =
    !pane.continueDismissed &&
    pane.cliId !== "terminal" &&
    (!!pane.resumeOfferPending || !!pane.canResume);

  const [branch, setBranch] = useState(BRANCH_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void tui
        .gitBranch(pane.cwd)
        .then((name) => {
          if (!cancelled) {
            setBranch(String(name || BRANCH_FALLBACK));
          }
        })
        .catch(() => {
          // No git / invoke failure / backend error — never surface to UI.
          if (!cancelled) {
            setBranch(BRANCH_FALLBACK);
          }
        });
    };
    load();
    if (!visible) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(load, BRANCH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pane.cwd, visible]);

  return (
    <div
      className={`term-pane${visible ? " visible" : ""}`}
      style={{ flex: `${flex} 1 0` }}
      onMouseDown={() => onFocus()}
    >
      <div className="pane-chrome">
        <span className="pane-cwd" title={chromeText}>
          {toolLabel}{" "}
          <span className="pane-sep" aria-hidden="true">
            ·
          </span>{" "}
          {pane.cwd}
        </span>
        <div className="pane-actions">
          {showContinue ? (
            <button
              type="button"
              className="pane-continue"
              title="继续上次会话"
              onClick={(e) => {
                e.stopPropagation();
                onContinue();
              }}
            >
              ↻
            </button>
          ) : null}
          <button
            type="button"
            className="pane-detach"
            title="独立为新会话"
            hidden={!showDetach}
            onClick={(e) => {
              e.stopPropagation();
              onDetach();
            }}
          >
            ⤢
          </button>
          <button
            type="button"
            className="pane-close"
            title="关闭此栏"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div className="pane-body" onMouseDown={() => onFocus()}>
        <TerminalHost
          sessionId={pane.id}
          visible={visible}
          onSubmitChat={onSubmitChat}
          onCliSessionCleared={onCliSessionCleared}
          onActivityData={onActivityData}
          onContextMenu={onContextMenu}
          onExit={onExit}
          onTermReady={onTermReady}
        />
      </div>
      <div
        className="pane-branch"
        title={
          branch === BRANCH_FALLBACK
            ? "非 git 仓库或无法读取分支"
            : `当前分支：${branch}`
        }
      >
        {branch !== BRANCH_FALLBACK ? (
          <svg
            className="pane-branch-icon"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="4" cy="3" r="1.75" fill="currentColor" />
            <circle cx="4" cy="13" r="1.75" fill="currentColor" />
            <circle cx="12" cy="8" r="1.75" fill="currentColor" />
            <path
              d="M4 4.75v6.5M4 8h5.5a2.5 2.5 0 0 0 2.5-2.5V5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <span className="pane-branch-name">{branch}</span>
      </div>
    </div>
  );
}
