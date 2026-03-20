import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { GmailSyncRun } from "@connex/shared";
import * as api from "../api/client.js";
import { useAuth } from "./useAuth.js";

interface SyncStatusContextType {
  run: GmailSyncRun | null;
  isSyncing: boolean;
  refresh: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const SyncStatusContext = createContext<SyncStatusContextType | null>(null);

const POLL_INTERVAL_MS = 2000;

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [run, setRun] = useState<GmailSyncRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const status = await api.getGmailSyncStatus();
      if ("id" in status) {
        setRun(status);
        if (status.status !== "running") stopPolling();
      } else {
        setRun(null);
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [poll]);

  const refresh = useCallback(async () => {
    await poll();
  }, [poll]);

  const triggerSync = useCallback(async () => {
    const res = await api.triggerGmailSync();
    setRun(res);
    if (res.status === "running") startPolling();
  }, [startPolling]);

  useEffect(() => {
    if (!user) {
      setRun(null);
      stopPolling();
      return;
    }
    // Initial check on login / mount.
    poll().then(() => {
      // If running, start polling.
      // poll() already stops polling when not running; explicitly start if running.
    });
    // Defer decision to next microtask so poll() has set state.
    api.getGmailSyncStatus().then((s) => {
      if ("id" in s && s.status === "running") startPolling();
    }).catch(() => {});

    return stopPolling;
  }, [user, poll, stopPolling, startPolling]);

  // Restart polling whenever run flips to running (e.g. triggered from another tab).
  useEffect(() => {
    if (run?.status === "running") startPolling();
  }, [run?.status, startPolling]);

  const isSyncing = run?.status === "running";

  return (
    <SyncStatusContext.Provider value={{ run, isSyncing, refresh, triggerSync }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusContextType {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) throw new Error("useSyncStatus must be used within SyncStatusProvider");
  return ctx;
}
