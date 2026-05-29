"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import type { NotificationRecord } from "@/lib/notifications/types";
import { useCallback, useEffect, useState } from "react";

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

/** Shared customer notification state backed by /api/customer/notifications. */
export function useCustomerNotifications(): CustomerNotificationsApi {
  const { status, getIdToken } = useCustomerAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const response = await fetch("/api/customer/notifications", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        notifications?: NotificationRecord[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Could not load notifications.");
        return;
      }
      setNotifications(payload.notifications ?? []);
    } catch {
      setError("Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [status, getIdToken]);

  useEffect(() => {
    if (status === "authenticated") {
      void reload();
    } else {
      setNotifications([]);
    }
  }, [status, reload]);

  const markAllRead = useCallback(async () => {
    const hasUnread = notifications.some((note) => !note.read);
    if (!hasUnread) return;
    setNotifications((current) =>
      current.map((note) => ({ ...note, read: true })),
    );
    const idToken = await getIdToken();
    if (!idToken) return;
    await fetch("/api/customer/notifications", {
      method: "PATCH",
      headers: { authorization: `Bearer ${idToken}` },
    });
  }, [notifications, getIdToken]);

  const clearOne = useCallback(
    async (id: string) => {
      const previous = notifications;
      setNotifications((current) => current.filter((note) => note.id !== id));
      const idToken = await getIdToken();
      if (!idToken) return;
      const response = await fetch(`/api/customer/notifications/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) setNotifications(previous);
    },
    [notifications, getIdToken],
  );

  const clearAll = useCallback(async () => {
    const previous = notifications;
    setNotifications([]);
    const idToken = await getIdToken();
    if (!idToken) return;
    const response = await fetch("/api/customer/notifications", {
      method: "DELETE",
      headers: { authorization: `Bearer ${idToken}` },
    });
    if (!response.ok) setNotifications(previous);
  }, [notifications, getIdToken]);

  const unread = notifications.filter((note) => !note.read).length;

  return {
    notifications,
    loading,
    error,
    unread,
    reload,
    markAllRead,
    clearOne,
    clearAll,
  };
}
