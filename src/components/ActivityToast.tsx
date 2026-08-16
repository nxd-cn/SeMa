import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

const TOAST_MS = 10000;

type Props = {
  onSelect: (groupId: string) => void;
};

export default function ActivityToast({ onSelect }: Props) {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const alive = new Set(toasts.map((t) => t.groupId));
    for (const [gid, timer] of timers.current) {
      if (!alive.has(gid)) {
        clearTimeout(timer);
        timers.current.delete(gid);
      }
    }
    for (const t of toasts) {
      if (timers.current.has(t.groupId)) continue;
      const timer = setTimeout(() => {
        timers.current.delete(t.groupId);
        removeToast(t.groupId);
      }, TOAST_MS);
      timers.current.set(t.groupId, timer);
    }
  }, [toasts, removeToast]);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  return (
    <div id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.groupId}
          type="button"
          className="toast"
          onClick={() => {
            removeToast(t.groupId);
            onSelect(t.groupId);
          }}
        >
          {t.label} · 本轮结束
        </button>
      ))}
    </div>
  );
}
