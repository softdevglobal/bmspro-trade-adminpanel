"use client";

import { BROADCAST_NOTIFICATION_PREFIX } from "@/lib/broadcasts/types";
import type { BroadcastForUser } from "@/lib/broadcasts/types";
import type { NotificationRecord } from "@/lib/notifications/types";

type NotificationsResponse = {
  ok: boolean;
  notifications?: NotificationRecord[];
  error?: string;
};

type BroadcastsResponse = {
  ok: boolean;
  broadcasts?: BroadcastForUser[];
  error?: string;
};

/** True when an id belongs to a broadcast (custom message) notification. */
export function isBroadcastNotificationId(id: string): boolean {
  return id.startsWith(BROADCAST_NOTIFICATION_PREFIX);
}

/** Strips the broadcast prefix to recover the raw broadcast document id. */
export function broadcastIdFromNotificationId(id: string): string {
  return id.startsWith(BROADCAST_NOTIFICATION_PREFIX)
    ? id.slice(BROADCAST_NOTIFICATION_PREFIX.length)
    : id;
}

function broadcastToNotification(item: BroadcastForUser): NotificationRecord {
  return {
    id: `${BROADCAST_NOTIFICATION_PREFIX}${item.id}`,
    audience: "business",
    businessId: null,
    customerId: null,
    customerEmail: null,
    requestId: "",
    bookingSlug: null,
    businessName: null,
    customerName: null,
    status: "pending",
    type: "system_message",
    title: item.title,
    body: item.body,
    read: item.read,
    createdAt: item.createdAt,
  };
}

/** Fetches custom-message broadcasts for the admin panel as notification records. */
export async function fetchBroadcastNotifications(
  idToken: string,
): Promise<NotificationRecord[]> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as BroadcastsResponse;
  if (!response.ok || !body.ok || !body.broadcasts) {
    throw new Error(body.error ?? "Could not load messages.");
  }
  return body.broadcasts.map(broadcastToNotification);
}

export async function markAllBroadcastsReadApi(idToken: string): Promise<void> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    method: "PATCH",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not mark messages read.");
  }
}

export async function dismissBroadcastApi(
  idToken: string,
  broadcastId: string,
): Promise<void> {
  const response = await fetch(`/api/broadcasts/${broadcastId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not dismiss message.");
  }
}

export async function dismissAllBroadcastsApi(idToken: string): Promise<void> {
  const response = await fetch("/api/broadcasts?platform=admin", {
    method: "DELETE",
    headers: { authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error("Could not clear messages.");
  }
}

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
  bookingSlug?: string,
): Promise<NotificationRecord[]> {
  const qs = bookingSlug
    ? `?bookingSlug=${encodeURIComponent(bookingSlug)}`
    : "";
  const response = await fetch(`/api/customer/notifications${qs}`, {
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
