import { useEffect, useRef } from "react";

export type ContextMenuState = {
  x: number;
  y: number;
  paneId: string;
  hasSelection: boolean;
} | null;

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
  onAction: (action: "copy" | "paste" | "delete" | "selectAll") => void;
};

export default function ContextMenu({ menu, onClose, onAction }: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  useEffect(() => {
    if (!menu || !elRef.current) return;
    const el = elRef.current;
    const pad = 4;
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 90;
    const left = Math.min(menu.x, window.innerWidth - w - pad);
    const top = Math.min(menu.y, window.innerHeight - h - pad);
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  }, [menu]);

  if (!menu) {
    return (
      <div id="term-ctx" className="term-ctx hidden" role="menu" hidden />
    );
  }

  return (
    <div
      id="term-ctx"
      ref={elRef}
      className="term-ctx"
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-action="copy"
        role="menuitem"
        disabled={!menu.hasSelection}
        onClick={() => onAction("copy")}
      >
        复制
      </button>
      <button
        type="button"
        data-action="paste"
        role="menuitem"
        onClick={() => onAction("paste")}
      >
        粘贴
      </button>
      <button
        type="button"
        data-action="delete"
        role="menuitem"
        disabled={!menu.hasSelection}
        onClick={() => onAction("delete")}
      >
        删除
      </button>
      <button
        type="button"
        data-action="selectAll"
        role="menuitem"
        onClick={() => onAction("selectAll")}
      >
        全选
      </button>
    </div>
  );
}
