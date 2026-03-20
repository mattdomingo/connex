import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./useAuth.js";
import * as api from "../api/client.js";

interface SyncStatusContextType {
  syncing: boolean;
  messagesScanned: number;
}

const SyncStatusContext = createContext<SyncStatusContextType>({ syncing: false, messagesScanned: 0 });

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [messagesScanned, setMessagesScanned] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const ss = await api.getGmailSyncStatus();
      if ("status" in ss && ss.status === "running") {
        setSyncing(true);
        setMessagesScanned(ss.messagesScanned ?? 0);
      } else {
        setSyncing(false);
        setMessagesScanned(0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    // Initial check
    poll();
    // Poll every 4 seconds
    pollRef.current = setInterval(poll, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, poll]);

  return (
    <SyncStatusContext.Provider value={{ syncing, messagesScanned }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusContextType {
  return useContext(SyncStatusContext);
}
