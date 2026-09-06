import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { queueMutation, getQueuedMutations, clearMutation } from '../services/offlineStore';

const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Count pending mutations on mount
  useEffect(() => {
    getQueuedMutations().then(q => setPendingMutations(q.length)).catch(() => {});
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  const enqueue = useCallback(async (method, url, body) => {
    await queueMutation(method, url, body);
    const q = await getQueuedMutations();
    setPendingMutations(q.length);
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const mutations = await getQueuedMutations();
      for (const m of mutations) {
        try {
          await api({ method: m.method, url: m.url, data: m.body });
          await clearMutation(m.id);
        } catch {
          // Stop on first failure — network may have dropped
          break;
        }
      }
      const remaining = await getQueuedMutations();
      setPendingMutations(remaining.length);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && pendingMutations > 0) {
      syncQueue();
    }
  }, [isOnline, pendingMutations, syncQueue]);

  return (
    <OfflineContext.Provider value={{ isOnline, pendingMutations, syncing, enqueue, syncQueue, installPrompt, promptInstall }}>
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
