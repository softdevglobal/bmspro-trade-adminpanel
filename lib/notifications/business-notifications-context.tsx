"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  connectBusinessNotificationStream,
  deleteAllBusinessNotificationsApi,
  deleteBusinessNotificationApi,
  fetchBusinessNotifications,
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
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
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
      const records = await fetchBusinessNotifications(token);
      setNotifications(records);
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
        setNotifications([]);
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

  const unread = notifications.filter((note) => !note.read).length;

  const markAllRead = useCallback(async () => {
    if (!user || unread === 0) return;
    const previous = notifications;
    setNotifications((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    try {
      const token = await user.getIdToken();
      await markAllBusinessNotificationsReadApi(token);
    } catch {
      setNotifications(previous);
    }
  }, [user, unread, notifications]);

  const clearOne = useCallback(
    async (id: string) => {
      if (!user) return;
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      try {
        const token = await user.getIdToken();
        await deleteBusinessNotificationApi(token, id);
      } catch {
        setNotifications(previous);
      }
    },
    [user, notifications],
  );

  const clearAll = useCallback(async () => {
    if (!user || notifications.length === 0) return;
    const previous = notifications;
    setNotifications([]);
    try {
      const token = await user.getIdToken();
      await deleteAllBusinessNotificationsApi(token);
    } catch {
      setNotifications(previous);
    }
  }, [user, notifications]);

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
