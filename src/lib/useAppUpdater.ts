import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateOffer = {
  version: string;
  notes: string;
};

export type UpdateProgress = {
  downloaded: number;
  total: number;
  /** 0–100 when total known; otherwise null. */
  percent: number | null;
  label: string;
};

export type UpdateUiState = {
  currentVersion: string;
  offer: UpdateOffer | null;
  busy: boolean;
  checking: boolean;
  checkFailed: boolean;
  progress: UpdateProgress | null;
  error: string;
  install: () => Promise<void>;
  recheck: () => Promise<void>;
};

/**
 * Packaged builds: check GitHub latest.json on launch (and on manual recheck).
 * Download / install / relaunch from the sidebar footer — no modal.
 */
export function useAppUpdater(): UpdateUiState {
  const [currentVersion, setCurrentVersion] = useState("");
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState("");
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setCurrentVersion(v);
      } catch {
        if (!cancelled) setCurrentVersion("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runCheck = useCallback(async () => {
    if (import.meta.env.DEV) return;
    if (checkingRef.current || busyRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setError("");
    try {
      const update = await check();
      setCheckFailed(false);
      if (!update) {
        updateRef.current = null;
        setOffer(null);
        return;
      }
      updateRef.current = update;
      setOffer({
        version: update.version,
        notes: (update.body || "").trim(),
      });
    } catch {
      updateRef.current = null;
      setOffer(null);
      setCheckFailed(true);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const recheck = useCallback(async () => {
    if (busyRef.current) return;
    await runCheck();
  }, [runCheck]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setProgress({
      downloaded: 0,
      total: 0,
      percent: null,
      label: "准备下载…",
    });
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(makeProgress(downloaded, total));
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(makeProgress(downloaded, total));
        } else if (event.event === "Finished") {
          setProgress({
            downloaded,
            total,
            percent: total > 0 ? 100 : null,
            label: "正在安装…",
          });
        }
      });
      await relaunch();
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    currentVersion,
    offer,
    busy,
    checking,
    checkFailed,
    progress,
    error,
    install,
    recheck,
  };
}

function makeProgress(downloaded: number, total: number): UpdateProgress {
  if (total > 0) {
    const percent = Math.min(100, Math.round((downloaded / total) * 100));
    return {
      downloaded,
      total,
      percent,
      label: `${percent}%`,
    };
  }
  return {
    downloaded,
    total,
    percent: null,
    label: formatBytes(downloaded),
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Hover title for the download button: version + release notes. */
export function updateOfferTitle(offer: UpdateOffer): string {
  const head = `更新至 v${offer.version.replace(/^v/i, "")}`;
  return offer.notes ? `${head}\n\n${offer.notes}` : head;
}
