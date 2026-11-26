"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  connectCustomerNotificationStream,
  deleteAllCustomerNotificationsApi,
  deleteCustomerNotificationApi,
  fetchCustomerNotifications,
  markAllCustomerNotificationsReadApi,
} from "@/lib/notifications/api-client";
import type { NotificationRecord } from "@/lib/notifications/types";
import { createCoalescedRefresh } from "@/lib/data/coalesced-refresh";
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

function isCustomerBookingRoute(pathname: string | null): boolean {
  return Boolean(pathname?.startsWith("/booknow"));
}

export type CustomerNotificationsApi = {
  notifications: NotificationRecord[];
  loading: boolean;
  error: string | null;
  unread: number;
  reload: () => Promise<void>;
  markAllRead: () => Promise<void>;
  clearOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

const CustomerNotificationsContext =
  createContext<CustomerNotificationsApi | null>(null);

/** Customer notifications via HTTP + SSE (no Firestore listeners). */
export function CustomerNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { status, user, getIdToken, activeBookingSlug } = useCustomerAuth();
  const pageVisible = usePageVisible();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const enabled =
    status === "authenticated" &&
    Boolean(user?.uid) &&
    Boolean(user?.email) &&
    isCustomerBookingRoute(pathname);

  const notificationCountRef = useRef(0);
  useEffect(() => { notificationCountRef.current = notifications.length; }, [notifications.length]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading((current) => current || notificationCountRef.current === 0);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in.");
      const records = await fetchCustomerNotifications(
        token,
        activeBookingSlug,
      );
      setNotifications(records);
      // A later success must clear an earlier failure, otherwise a single
      // transient error keeps showing over notifications we now hold.
      setError(null);
    } catch {
      setError("Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [activeBookingSlug, enabled, getIdToken]);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    if (!enabled || !pageVisible) {
      if (!enabled) {
        let cancelled = false;
        queueMicrotask(() => {
          if (cancelled) return;
          setNotifications([]);
          setLoading(false);
          setError(null);
        });
        return () => { cancelled = true; };
      }
      return;
    }

    const refresh = createCoalescedRefresh(() => reloadRef.current());
    refresh.request();

    // Reconnects fetch a current token, so the stream outlives the 1-hour token.
    const disconnectStream = connectCustomerNotificationStream(
      async () => (await getIdToken()) ?? null,
      () => refresh.request(),
    );

    const onFocus = () => refresh.request();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => refresh.request(), 120_000);

    return () => {
      refresh.dispose();
      disconnectStream();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [enabled, pageVisible, reload, getIdToken]);

  const markAllRead = useCallback(async () => {
    const hasUnread = notifications.some((note) => !note.read);
    if (!hasUnread) return;
    const previous = notifications;
    setNotifications((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in.");
      await markAllCustomerNotificationsReadApi(token, activeBookingSlug);
    } catch {
      setNotifications(previous);
    }
  }, [notifications, getIdToken, activeBookingSlug]);

  const clearOne = useCallback(
    async (id: string) => {
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Not signed in.");
        await deleteCustomerNotificationApi(token, id, activeBookingSlug);
      } catch {
        setNotifications(previous);
      }
    },
    [notifications, getIdToken, activeBookingSlug],
  );

  const clearAll = useCallback(async () => {
    const previous = notifications;
    setNotifications([]);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in.");
      await deleteAllCustomerNotificationsApi(token, activeBookingSlug);
    } catch {
      setNotifications(previous);
    }
  }, [notifications, getIdToken, activeBookingSlug]);

  const unread = notifications.filter((note) => !note.read).length;

  const value = useMemo<CustomerNotificationsApi>(
    () => ({
      notifications,
      loading,
      error,
      unread,
      reload,
      markAllRead,
      clearOne,
      clearAll,
    }),
    [
      notifications,
      loading,
      error,
      unread,
      reload,
      markAllRead,
      clearOne,
      clearAll,
    ],
  );

  return (
    <CustomerNotificationsContext.Provider value={value}>
      {children}
    </CustomerNotificationsContext.Provider>
  );
}

export function useCustomerNotifications(): CustomerNotificationsApi {
  const context = useContext(CustomerNotificationsContext);
  if (!context) {
    throw new Error(
      "useCustomerNotifications must be used within CustomerNotificationsProvider",
    );
  }
  return context;
}
