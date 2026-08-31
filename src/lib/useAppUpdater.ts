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
  /** Brief status after a successful check with no newer version. */
  upToDate: boolean;
  progress: UpdateProgress | null;
  error: string;
  /** False in `tauri:dev` — updater APIs are skipped there. */
  canUpdate: boolean;
  install: () => Promise<void>;
  recheck: () => Promise<void>;
};

function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const s = String(e ?? "").trim();
  return s || "未知错误";
}

/**
 * Packaged builds: check GitHub latest.json on launch (and on manual recheck).
 * Download / install / relaunch from the sidebar footer — no modal.
 */
export function useAppUpdater(): UpdateUiState {
  const canUpdate = !import.meta.env.DEV;
  const [currentVersion, setCurrentVersion] = useState("");
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState("");
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const busyRef = useRef(false);
  const upToDateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (upToDateTimerRef.current) clearTimeout(upToDateTimerRef.current);
    };
  }, []);

  const flashUpToDate = useCallback(() => {
    setUpToDate(true);
    if (upToDateTimerRef.current) clearTimeout(upToDateTimerRef.current);
    upToDateTimerRef.current = setTimeout(() => setUpToDate(false), 4000);
  }, []);

  const runCheck = useCallback(async () => {
    if (!canUpdate) return;
    if (checkingRef.current || busyRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setError("");
    setUpToDate(false);
    try {
      const update = await check();
      setCheckFailed(false);
      if (!update) {
        updateRef.current = null;
        setOffer(null);
        flashUpToDate();
        return;
      }
      updateRef.current = update;
      setOffer({
        version: update.version,
        notes: (update.body || "").trim(),
      });
    } catch (e) {
      updateRef.current = null;
      setOffer(null);
      setCheckFailed(true);
      setError(errMessage(e));
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [canUpdate, flashUpToDate]);

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
    setUpToDate(false);
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
      setError(errMessage(e));
    }
  }, []);

  return {
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
