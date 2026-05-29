"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  deleteAllNotificationsClient,
  deleteNotificationClient,
  markAllNotificationsReadClient,
  subscribeBusinessNotifications,
} from "@/lib/notifications/firestore-client";
import type { NotificationRecord } from "@/lib/notifications/types";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { useCallback, useEffect, useState } from "react";

export type BusinessNotificationsApi = {
  notifications: NotificationRecord[];
  loading: boolean;
  unread: number;
  markAllRead: () => Promise<void>;
  clearOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

/** Live business-owner notification feed via Firestore (no /api polling). */
export function useBusinessNotifications(): BusinessNotificationsApi {
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const enabled = role === "business_owner" && Boolean(businessId);

  useEffect(() => {
    if (!enabled || !businessId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    const unsubscribe = subscribeBusinessNotifications(
      businessId,
      (records) => {
        setNotifications(records);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible]);

  const markAllRead = useCallback(async () => {
    const hasUnread = notifications.some((note) => !note.read);
    if (!hasUnread) return;
    const previous = notifications;
    setNotifications((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    try {
      await markAllNotificationsReadClient("business", previous);
    } catch {
      setNotifications(previous);
    }
  }, [notifications]);

  const clearOne = useCallback(
    async (id: string) => {
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      try {
        await deleteNotificationClient("business", id);
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
      await deleteAllNotificationsClient("business", previous);
    } catch {
      setNotifications(previous);
    }
  }, [notifications]);

  const unread = notifications.filter((note) => !note.read).length;

  return {
    notifications,
    loading,
    unread,
    markAllRead,
    clearOne,
    clearAll,
  };
}
