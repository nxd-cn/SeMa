import { useEffect, useRef, useState } from "react";
import { tui } from "../api/tui";
import { commitCustomTitle } from "../lib/commitCustomTitle";
import { newSessionShortcutLabel } from "../lib/newSessionKeys";
import { groupLabel, useAppStore } from "../store/appStore";

type Props = {
  onNewSession: () => void;
  onActivateGroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onMergeGroups?: (sourceId: string, targetId: string) => void;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ghost, setGhost] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const endDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    setGhost(null);
  };

  useEffect(() => {
    if (!draggingId) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [draggingId]);

  const groupIdFromPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    const li = el?.closest("#tabs li[data-group-id]") as HTMLElement | null;
    return li?.dataset.groupId || null;
  };

  const onPointerDown = (e: React.PointerEvent, groupId: string, label: string) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      sourceId: groupId,
      label,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      armed: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
      setDraggingId(drag.sourceId);
    }
    setGhost({
      label: drag.label,
      x: e.clientX - drag.offsetX,
      y: e.clientY - drag.offsetY,
    });
    const over = groupIdFromPoint(e.clientX, e.clientY);
    setDropTargetId(over && over !== drag.sourceId ? over : null);
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
      const target = groupIdFromPoint(e.clientX, e.clientY);
      if (target && target !== drag.sourceId && onMergeGroups) {
        onMergeGroups(drag.sourceId, target);
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
        <ul id="tabs">
          {groups.map((g) => {
            const label = groupLabel(g, panes);
            const cwd = panes[g.paneIds[0]]?.cwd || "";
            const classes = [
              g.id === activeGroupId ? "active" : "",
              g.busy ? "busy" : "",
              g.unread ? "unread" : "",
              draggingId === g.id ? "dragging" : "",
              dropTargetId === g.id ? "drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={g.id}
                data-group-id={g.id}
                tabIndex={0}
                className={classes}
                title={`${label}\n${cwd}\n拖到其他标签可合并分栏`}
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
