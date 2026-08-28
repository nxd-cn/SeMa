import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateOffer = {
  version: string;
  notes: string;
};

export type UpdateUiState = {
  offer: UpdateOffer | null;
  busy: boolean;
  status: string;
  error: string;
  install: () => Promise<void>;
  dismiss: () => void;
};

/**
 * On launch (packaged builds only), check GitHub latest.json for a newer version.
 * User confirms → download + install + relaunch (no uninstall needed).
 */
export function useAppUpdater(): UpdateUiState {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;
    void (async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        updateRef.current = update;
        setOffer({
          version: update.version,
          notes: (update.body || "").trim(),
        });
      } catch {
        /* offline / no latest.json / unsigned skip */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (busy) return;
    updateRef.current = null;
    setOffer(null);
    setError("");
    setStatus("");
  }, [busy]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busy) return;
    setBusy(true);
    setError("");
    setStatus("正在下载更新…");
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setStatus(
            total > 0
              ? `正在下载更新… 0 / ${formatBytes(total)}`
              : "正在下载更新…",
          );
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus(
            total > 0
              ? `正在下载更新… ${formatBytes(downloaded)} / ${formatBytes(total)}`
              : `正在下载更新… ${formatBytes(downloaded)}`,
          );
        } else if (event.event === "Finished") {
          setStatus("正在安装并重启…");
        }
      });
      await relaunch();
    } catch (e) {
      setBusy(false);
      setStatus("");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [busy]);

  return { offer, busy, status, error, install, dismiss };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
