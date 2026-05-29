"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  deleteAllNotificationsClient,
  deleteNotificationClient,
  markAllNotificationsReadClient,
  subscribeBusinessNotificationsFull,
  subscribeBusinessNotificationsUnread,
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
 * Unread-only listener for the badge; full list only while the panel is open.
 */
export function BusinessNotificationsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [panelOpen, setPanelOpen] = useState(false);
  const [unreadList, setUnreadList] = useState<NotificationRecord[]>([]);
  const [fullList, setFullList] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    isDashboardRoute(pathname);

  useEffect(() => {
    if (!enabled || !businessId) {
      setUnreadList([]);
      setFullList([]);
      setLoading(false);
      return;
    }
    if (!pageVisible) return;

    const unsubscribe = subscribeBusinessNotificationsUnread(
      businessId,
      setUnreadList,
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible]);

  useEffect(() => {
    if (!enabled || !businessId || !panelOpen) {
      setFullList([]);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    const unsubscribe = subscribeBusinessNotificationsFull(
      businessId,
      (records) => {
        setFullList(records);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible, panelOpen]);

  const notifications = panelOpen ? fullList : unreadList;
  const unread = unreadList.filter((note) => !note.read).length;

  const markAllRead = useCallback(async () => {
    const source = panelOpen ? fullList : unreadList;
    const hasUnread = source.some((note) => !note.read);
    if (!hasUnread) return;
    const previousUnread = unreadList;
    const previousFull = fullList;
    setUnreadList((current) => current.map((note) => ({ ...note, read: true })));
    setFullList((current) => current.map((note) => ({ ...note, read: true })));
    try {
      await markAllNotificationsReadClient("business", source);
    } catch {
      setUnreadList(previousUnread);
      setFullList(previousFull);
    }
  }, [panelOpen, fullList, unreadList]);

  const clearOne = useCallback(
    async (id: string) => {
      const previousUnread = unreadList;
      const previousFull = fullList;
      setUnreadList((current) => current.filter((note) => note.id !== id));
      setFullList((current) => current.filter((note) => note.id !== id));
      try {
        await deleteNotificationClient("business", id);
      } catch {
        setUnreadList(previousUnread);
        setFullList(previousFull);
      }
    },
    [unreadList, fullList],
  );

  const clearAll = useCallback(async () => {
    const source = panelOpen ? fullList : unreadList;
    const previousUnread = unreadList;
    const previousFull = fullList;
    setUnreadList([]);
    setFullList([]);
    try {
      await deleteAllNotificationsClient("business", source);
    } catch {
      setUnreadList(previousUnread);
      setFullList(previousFull);
    }
  }, [panelOpen, fullList, unreadList]);

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
