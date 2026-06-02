"use client";

import type { NotificationRecord } from "@/lib/notifications/types";

type NotificationsResponse = {
  ok: boolean;
  notifications?: NotificationRecord[];
  error?: string;
};

export async function fetchBusinessNotifications(
  idToken: string,
): Promise<NotificationRecord[]> {
  const response = await fetch("/api/notifications", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as NotificationsResponse;
  if (!response.ok || !body.ok || !body.notifications) {
    throw new Error(body.error ?? "Could not load notifications.");
  }
  return body.notifications;
}

export async function fetchCustomerNotifications(
  idToken: string,
): Promise<NotificationRecord[]> {
  const response = await fetch("/api/customer/notifications", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as NotificationsResponse;
  if (!response.ok || !body.ok || !body.notifications) {
    throw new Error(body.error ?? "Could not load notifications.");
  }
  return body.notifications;
}

/**
 * Opens an SSE stream; calls `onRefresh` when the server signals new activity.
 * Uses query token because EventSource cannot set Authorization headers.
 */
export function connectBusinessNotificationStream(
  idToken: string,
  onRefresh: () => void,
): () => void {
  const url = `/api/notifications/stream?access_token=${encodeURIComponent(idToken)}`;
  const source = new EventSource(url);

  const handleRefresh = () => onRefresh();
  source.addEventListener("refresh", handleRefresh);
  source.onmessage = handleRefresh;

  return () => {
    source.removeEventListener("refresh", handleRefresh);
    source.close();
  };
}

export function connectCustomerNotificationStream(
  idToken: string,
  onRefresh: () => void,
): () => void {
  const url = `/api/customer/notifications/stream?access_token=${encodeURIComponent(idToken)}`;
  const source = new EventSource(url);

  const handleRefresh = () => onRefresh();
  source.addEventListener("refresh", handleRefresh);
  source.onmessage = handleRefresh;

  return () => {
    source.removeEventListener("refresh", handleRefresh);
    source.close();
  };
}

export async function patchBusinessNotification(
  idToken: string,
  id: string,
): Promise<void> {
  const response = await fetch(`/api/notifications/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not update notification.");
  }
}

export async function deleteBusinessNotificationApi(
  idToken: string,
  id: string,
): Promise<void> {
  const response = await fetch(`/api/notifications/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not delete notification.");
  }
}

export async function markAllBusinessNotificationsReadApi(
  idToken: string,
): Promise<void> {
  const response = await fetch("/api/notifications", {
    method: "PATCH",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not mark notifications read.");
  }
}

export async function deleteAllBusinessNotificationsApi(
  idToken: string,
): Promise<void> {
  const response = await fetch("/api/notifications", {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not clear notifications.");
  }
}

export async function markAllCustomerNotificationsReadApi(
  idToken: string,
): Promise<void> {
  const response = await fetch("/api/customer/notifications", {
    method: "PATCH",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not mark notifications read.");
  }
}

export async function deleteCustomerNotificationApi(
  idToken: string,
  id: string,
): Promise<void> {
  const response = await fetch(`/api/customer/notifications/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not delete notification.");
  }
}

export async function deleteAllCustomerNotificationsApi(
  idToken: string,
): Promise<void> {
  const response = await fetch("/api/customer/notifications", {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not clear notifications.");
  }
}
