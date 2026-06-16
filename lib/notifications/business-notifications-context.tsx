"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  broadcastIdFromNotificationId,
  connectBusinessNotificationStream,
  deleteAllBusinessNotificationsApi,
  deleteBusinessNotificationApi,
  dismissAllBroadcastsApi,
  dismissBroadcastApi,
  fetchBroadcastNotifications,
  fetchBusinessNotifications,
  isBroadcastNotificationId,
  markAllBroadcastsReadApi,
  markAllBusinessNotificationsReadApi,
} from "@/lib/notifications/api-client";
import type { NotificationRecord } from "@/lib/notifications/types";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type BusinessNotificationsApi = {
  notifications: NotificationRecord[];
  loading: boolean;
  unread: number;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  markAllRead: () => Promise<void>;
  clearOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

const BusinessNotificationsContext =
  createContext<BusinessNotificationsApi | null>(null);

function isDashboardRoute(pathname: string | null): boolean {
  return Boolean(pathname?.startsWith("/dashboard"));
}

/**
 * Notifications via HTTP + SSE push (no Firestore snapshot listeners).
 */
export function BusinessNotificationsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();
  const [panelOpen, setPanelOpen] = useState(false);
  const [inspectionNotes, setInspectionNotes] = useState<NotificationRecord[]>([]);
  const [broadcastNotes, setBroadcastNotes] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    isDashboardRoute(pathname);

  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled || !user) return;
    setLoading((current) => current || !hasLoadedRef.current);
    try {
      const token = await user.getIdToken();
      const [records, broadcasts] = await Promise.all([
        fetchBusinessNotifications(token),
        fetchBroadcastNotifications(token).catch(() => []),
      ]);
      setInspectionNotes(records);
      setBroadcastNotes(broadcasts);
      hasLoadedRef.current = true;
    } catch {
      /* keep previous list */
    } finally {
      setLoading(false);
    }
  }, [enabled, user]);

  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled || !user || !pageVisible) {
      if (!enabled) {
        setInspectionNotes([]);
        setBroadcastNotes([]);
        setLoading(false);
        hasLoadedRef.current = false;
      }
      return;
    }

    void reload();

    let disconnectStream: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const token = await user.getIdToken();
        if (cancelled) return;
        disconnectStream = connectBusinessNotificationStream(token, () => {
          void reloadRef.current();
        });
      } catch {
        /* SSE optional; polling on focus still applies */
      }
    })();

    const onFocus = () => void reloadRef.current();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void reloadRef.current(), 120_000);

    return () => {
      cancelled = true;
      disconnectStream?.();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [enabled, user, pageVisible, reload]);

  const notifications = useMemo(
    () =>
      [...inspectionNotes, ...broadcastNotes].sort(
        (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      ),
    [inspectionNotes, broadcastNotes],
  );

  const unread = notifications.filter((note) => !note.read).length;

  const markAllRead = useCallback(async () => {
    if (!user || unread === 0) return;
    const previousInspection = inspectionNotes;
    const previousBroadcast = broadcastNotes;
    setInspectionNotes((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    setBroadcastNotes((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    try {
      const token = await user.getIdToken();
      await Promise.all([
        markAllBusinessNotificationsReadApi(token),
        markAllBroadcastsReadApi(token).catch(() => {}),
      ]);
    } catch {
      setInspectionNotes(previousInspection);
      setBroadcastNotes(previousBroadcast);
    }
  }, [user, unread, inspectionNotes, broadcastNotes]);

  const clearOne = useCallback(
    async (id: string) => {
      if (!user) return;
      const isBroadcast = isBroadcastNotificationId(id);
      const previousInspection = inspectionNotes;
      const previousBroadcast = broadcastNotes;
      if (isBroadcast) {
        setBroadcastNotes((current) => current.filter((note) => note.id !== id));
      } else {
        setInspectionNotes((current) => current.filter((note) => note.id !== id));
      }
      try {
        const token = await user.getIdToken();
        if (isBroadcast) {
          await dismissBroadcastApi(token, broadcastIdFromNotificationId(id));
        } else {
          await deleteBusinessNotificationApi(token, id);
        }
      } catch {
        setInspectionNotes(previousInspection);
        setBroadcastNotes(previousBroadcast);
      }
    },
    [user, inspectionNotes, broadcastNotes],
  );

  const clearAll = useCallback(async () => {
    if (!user || notifications.length === 0) return;
    const previousInspection = inspectionNotes;
    const previousBroadcast = broadcastNotes;
    setInspectionNotes([]);
    setBroadcastNotes([]);
    try {
      const token = await user.getIdToken();
      await Promise.all([
        deleteAllBusinessNotificationsApi(token),
        dismissAllBroadcastsApi(token).catch(() => {}),
      ]);
    } catch {
      setInspectionNotes(previousInspection);
      setBroadcastNotes(previousBroadcast);
    }
  }, [user, notifications.length, inspectionNotes, broadcastNotes]);

  const value = useMemo<BusinessNotificationsApi>(
    () => ({
      notifications,
      loading,
      unread,
      panelOpen,
      setPanelOpen,
      markAllRead,
      clearOne,
      clearAll,
    }),
    [
      notifications,
      loading,
      unread,
      panelOpen,
      markAllRead,
      clearOne,
      clearAll,
    ],
  );

  return (
    <BusinessNotificationsContext.Provider value={value}>
      {children}
    </BusinessNotificationsContext.Provider>
  );
}

export function useBusinessNotifications(): BusinessNotificationsApi {
  const context = useContext(BusinessNotificationsContext);
  if (!context) {
    throw new Error(
      "useBusinessNotifications must be used within BusinessNotificationsProvider",
    );
  }
  return context;
}
