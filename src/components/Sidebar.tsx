import { useEffect, useRef, useState } from "react";
import { tui } from "../api/tui";
import { commitCustomTitle } from "../lib/commitCustomTitle";
import { newSessionShortcutLabel } from "../lib/newSessionKeys";
import {
  resolveTabDropFromTarget,
  type TabDropAction,
} from "../lib/reorderGroups";
import { groupLabel, useAppStore } from "../store/appStore";

type Props = {
  onNewSession: () => void;
  onActivateGroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onMergeGroups?: (sourceId: string, targetId: string) => void;
  onReorderGroups?: (sourceId: string, insertBeforeIndex: number) => void;
  onRenameGroup?: (groupId: string, customTitle: string | null) => void;
  /** macOS: + lives in overlay title bar. */
  hideNewButton?: boolean;
};

type DragState = {
  sourceId: string;
  label: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  armed: boolean;
  clearSelectGuard?: () => void;
};

/**
 * Tab merge uses pointer drag (not HTML5 DnD).
 * Tauri's native file-drop handler swallows HTML5 `drop` unless
 * `dragDropEnabled: false` — pointer path stays reliable either way.
 */
export default function Sidebar({
  onNewSession,
  onActivateGroup,
  onCloseGroup,
  onMergeGroups,
  onReorderGroups,
  onRenameGroup,
  hideNewButton = false,
}: Props) {
  const groups = useAppStore((s) => s.groups);
  const panes = useAppStore((s) => s.panes);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);

  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [insertBeforeIndex, setInsertBeforeIndex] = useState<number | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ghost, setGhost] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const endDrag = () => {
    dragRef.current?.clearSelectGuard?.();
    dragRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    setInsertBeforeIndex(null);
    setGhost(null);
  };

  useEffect(() => {
    if (!draggingId) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    const preventSelect = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", preventSelect);
    return () => {
      document.body.style.cursor = prev;
      document.removeEventListener("selectstart", preventSelect);
    };
  }, [draggingId]);

  const tabMetricsFromDom = () => {
    const tabs = document.querySelectorAll("#tabs li[data-group-id]");
    return Array.from(tabs).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        id: (el as HTMLElement).dataset.groupId || "",
        index,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    });
  };

  const resolveDropAction = (
    clientY: number,
    sourceId: string
  ): TabDropAction => {
    const metrics = tabMetricsFromDom();
    if (!metrics.length) return { kind: "none" };

    const over = metrics.find(
      (m) => clientY >= m.top && clientY <= m.bottom
    );
    if (over) {
      return resolveTabDropFromTarget(
        sourceId,
        over.id,
        clientY - over.top,
        over.height,
        over.index
      );
    }
    if (clientY < metrics[0].top) {
      return { kind: "insert", insertBeforeIndex: 0 };
    }
    if (clientY > metrics[metrics.length - 1].bottom) {
      return { kind: "insert", insertBeforeIndex: groups.length };
    }
    return { kind: "none" };
  };

  const applyDropHint = (action: TabDropAction) => {
    if (action.kind === "merge") {
      setDropTargetId(action.targetId);
      setInsertBeforeIndex(null);
      return;
    }
    setDropTargetId(null);
    if (action.kind === "insert") {
      setInsertBeforeIndex(action.insertBeforeIndex);
      return;
    }
    setInsertBeforeIndex(null);
  };

  const onPointerDown = (e: React.PointerEvent, groupId: string, label: string) => {
    if (e.button !== 0) return;
    window.getSelection()?.removeAllRanges();
    const el = e.currentTarget as HTMLElement;
    const preventSelect = (ev: Event) => ev.preventDefault();
    el.addEventListener("selectstart", preventSelect);
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      sourceId: groupId,
      label,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      armed: false,
      clearSelectGuard: () => {
        el.removeEventListener("selectstart", preventSelect);
      },
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.armed) {
      if (dx * dx + dy * dy < 36) return; // 6px threshold
      drag.armed = true;
      suppressClick.current = true;
      window.getSelection()?.removeAllRanges();
      setDraggingId(drag.sourceId);
    }
    setGhost({
      label: drag.label,
      x: e.clientX - drag.offsetX,
      y: e.clientY - drag.offsetY,
    });
    applyDropHint(resolveDropAction(e.clientY, drag.sourceId));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (drag.armed) {
      const action = resolveDropAction(e.clientY, drag.sourceId);
      if (action.kind === "merge") {
        onMergeGroups?.(drag.sourceId, action.targetId);
      } else if (action.kind === "insert") {
        onReorderGroups?.(drag.sourceId, action.insertBeforeIndex);
      }
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    endDrag();
  };

  const onPointerCancel = () => {
    endDrag();
    suppressClick.current = false;
  };

  return (
    <aside id="sidebar" style={{ width: sidebarWidth }}>
      {hideNewButton ? null : (
        <button
          id="new-btn"
          type="button"
          title={`新建会话 (${newSessionShortcutLabel(tui.isMac)})`}
          onClick={() => void onNewSession()}
        >
          +
        </button>
      )}
      {/* Clip native overlay scrollbar (Mac WKWebView); still wheel-scrollable. */}
      <div className="sidebar-tabs-shell">
        <ul id="tabs" className={draggingId ? "is-dragging" : undefined}>
          {groups.map((g, index) => {
            const label = groupLabel(g, panes);
            const cwd = panes[g.paneIds[0]]?.cwd || "";
            const classes = [
              g.id === activeGroupId ? "active" : "",
              g.busy ? "busy" : "",
              g.unread ? "unread" : "",
              draggingId === g.id ? "dragging" : "",
              dropTargetId === g.id ? "drop-target" : "",
              insertBeforeIndex === index ? "drop-insert-before" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={g.id}
                data-group-id={g.id}
                tabIndex={0}
                className={classes}
                title={`${label}\n${cwd}\n拖动可排序；拖到标签中部可合并分栏`}
                onClick={() => {
                  if (suppressClick.current) return;
                  onActivateGroup(g.id);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  if (editingId === g.id) return;
                  setEditingId(g.id);
                  setDraft(label);
                }}
                onKeyDown={(e) => {
                  if (editingId === g.id) return;
                  if (e.key === "Delete") {
                    e.preventDefault();
                    onCloseGroup(g.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onCloseGroup(g.id);
                }}
                onPointerDown={(e) => {
                  if (editingId !== g.id) onPointerDown(e, g.id, label);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                {editingId === g.id ? (
                  <input
                    className="tab-rename-input"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        onRenameGroup?.(g.id, commitCustomTitle(draft));
                        setEditingId(null);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingId(null);
                      } else if (
                        e.key === "Delete" ||
                        e.key === "Backspace"
                      ) {
                        e.stopPropagation();
                      }
                    }}
                    onBlur={() => {
                      if (editingId !== g.id) return;
                      onRenameGroup?.(g.id, commitCustomTitle(draft));
                      setEditingId(null);
                    }}
                  />
                ) : (
                  label
                )}
              </li>
            );
          })}
          {insertBeforeIndex === groups.length ? (
            <li
              key="insert-end"
              className="tab-insert-marker"
              aria-hidden="true"
            />
          ) : null}
        </ul>
      </div>
      {ghost ? (
        <div
          className="tab-drag-ghost"
          style={{ left: ghost.x, top: ghost.y, width: sidebarWidth - 8 }}
        >
          {ghost.label}
        </div>
      ) : null}
    </aside>
  );
}
