"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  deleteAllNotificationsClient,
  deleteNotificationClient,
  markAllNotificationsReadClient,
  subscribeCustomerNotifications,
} from "@/lib/notifications/firestore-client";
import type { NotificationRecord } from "@/lib/notifications/types";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

/**
 * One Firestore listener per signed-in customer (shared by nav, bell, account).
 * Pauses while the tab is hidden to avoid background read charges.
 */
export function CustomerNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { status, user } = useCustomerAuth();
  const pageVisible = usePageVisible();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !user?.uid ||
      !user.email ||
      !isCustomerBookingRoute(pathname)
    ) {
      setNotifications([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeCustomerNotifications(
      user.uid,
      user.email,
      (records) => {
        setNotifications(records);
        setLoading(false);
        setError(null);
      },
      () => {
        setError("Could not load notifications.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [status, user?.uid, user?.email, pageVisible, pathname]);

  const reload = useCallback(async () => {
    /* Real-time listener keeps state fresh; no HTTP refetch. */
  }, []);

  const markAllRead = useCallback(async () => {
    const hasUnread = notifications.some((note) => !note.read);
    if (!hasUnread) return;
    const previous = notifications;
    setNotifications((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    try {
      await markAllNotificationsReadClient("customer", previous);
    } catch {
      setNotifications(previous);
    }
  }, [notifications]);

  const clearOne = useCallback(
    async (id: string) => {
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      try {
        await deleteNotificationClient("customer", id);
      } catch {
        setNotifications(previous);
      }
    },
    [notifications],
  );

  const clearAll = useCallback(async () => {
    const previous = notifications;
    setNotifications([]);
    try {
      await deleteAllNotificationsClient("customer", previous);
    } catch {
      setNotifications(previous);
    }
  }, [notifications]);

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
