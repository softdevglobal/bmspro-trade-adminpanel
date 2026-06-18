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

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading((current) => current || notifications.length === 0);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in.");
      const records = await fetchCustomerNotifications(
        token,
        activeBookingSlug,
      );
      setNotifications(records);
    } catch {
      setError("Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [activeBookingSlug, enabled, getIdToken, notifications.length]);

  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled || !pageVisible) {
      if (!enabled) {
        setNotifications([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    void reload();

    let disconnectStream: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        disconnectStream = connectCustomerNotificationStream(token, () => {
          void reloadRef.current();
        });
      } catch {
        /* SSE optional */
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
      await markAllCustomerNotificationsReadApi(token);
    } catch {
      setNotifications(previous);
    }
  }, [notifications, getIdToken]);

  const clearOne = useCallback(
    async (id: string) => {
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Not signed in.");
        await deleteCustomerNotificationApi(token, id);
      } catch {
        setNotifications(previous);
      }
    },
    [notifications, getIdToken],
  );

  const clearAll = useCallback(async () => {
    const previous = notifications;
    setNotifications([]);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not signed in.");
      await deleteAllCustomerNotificationsApi(token);
    } catch {
      setNotifications(previous);
    }
  }, [notifications, getIdToken]);

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
