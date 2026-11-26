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

/** `?bookingSlug=...` when known, so the API scopes to the right business. */
function customerNotificationsQuery(bookingSlug?: string): string {
  const slug = bookingSlug?.trim();
  return slug ? `?bookingSlug=${encodeURIComponent(slug)}` : "";
}

export async function fetchCustomerNotifications(
  idToken: string,
  bookingSlug?: string,
): Promise<NotificationRecord[]> {
  const qs = customerNotificationsQuery(bookingSlug);
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

/** A fixed ID token, or a function that returns a current one. */
export type StreamTokenSource = string | (() => Promise<string | null>);

/** Events in a server-sent-events text chunk that should trigger a refresh. */
export function countRefreshEvents(blocks: string[]): number {
  let count = 0;
  for (const block of blocks) {
    let event = "";
    let hasData = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue; // keep-alive comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) hasData = true;
    }
    // Same as EventSource: "refresh" events, and unnamed messages with data.
    if (event === "refresh" || (event === "" && hasData)) count += 1;
  }
  return count;
}

/**
 * Listens to a notification stream with the ID token in the Authorization
 * header. (EventSource can only send it in the URL, which writes the login
 * token into server and hosting request logs.) The server closes the stream
 * every few minutes; it reconnects with a current token each time, backing
 * off after errors, and stops for good on 401/403.
 */
function connectNotificationStream(
  path: string,
  token: StreamTokenSource,
  onRefresh: () => void,
): () => void {
  const controller = new AbortController();
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      retryTimer = setTimeout(resolve, ms);
    });

  void (async () => {
    while (!stopped) {
      try {
        const idToken = typeof token === "string" ? token : await token();
        if (!idToken || stopped) return;
        const response = await fetch(path, {
          headers: { authorization: `Bearer ${idToken}`, accept: "text/event-stream" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) return;
        if (!response.ok || !response.body) throw new Error("stream unavailable");
        retryDelay = 1_000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? "";
          for (let i = countRefreshEvents(blocks); i > 0; i -= 1) onRefresh();
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      await wait(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

/** Calls `onRefresh` when the server signals new business notifications. */
export function connectBusinessNotificationStream(
  token: StreamTokenSource,
  onRefresh: () => void,
): () => void {
  return connectNotificationStream("/api/notifications/stream", token, onRefresh);
}

/** Calls `onRefresh` when the server signals new customer notifications. */
export function connectCustomerNotificationStream(
  token: StreamTokenSource,
  onRefresh: () => void,
): () => void {
  return connectNotificationStream("/api/customer/notifications/stream", token, onRefresh);
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
  bookingSlug?: string,
): Promise<void> {
  const response = await fetch(
    `/api/customer/notifications${customerNotificationsQuery(bookingSlug)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${idToken}` },
    },
  );
  if (!response.ok) {
    throw new Error("Could not mark notifications read.");
  }
}

export async function deleteCustomerNotificationApi(
  idToken: string,
  id: string,
  bookingSlug?: string,
): Promise<void> {
  const response = await fetch(
    `/api/customer/notifications/${id}${customerNotificationsQuery(bookingSlug)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${idToken}` },
    },
  );
  if (!response.ok) {
    throw new Error("Could not delete notification.");
  }
}

export async function deleteAllCustomerNotificationsApi(
  idToken: string,
  bookingSlug?: string,
): Promise<void> {
  const response = await fetch(
    `/api/customer/notifications${customerNotificationsQuery(bookingSlug)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${idToken}` },
    },
  );
  if (!response.ok) {
    throw new Error("Could not clear notifications.");
  }
}
