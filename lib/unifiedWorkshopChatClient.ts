"use client";

import { CC_DIRECT_CHATS_COLLECTION, CONVERSATIONS_COLLECTION } from "@/lib/chat/types";
import { auth, db } from "@/lib/firebase/client";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

export type UnifiedChatMessage = {
  id: string;
  source: "support" | "cc";
  threadId: string;
  text: string;
  sender: "customer" | "agent" | "system";
  senderName: string;
  timestamp: number;
};

export type SupportConversationStatus = "waiting" | "connected" | "closed" | null;

export type OwnerClosedNotice = {
  message: string;
  agentName: string | null;
  closedAt: number | null;
};

export type UnifiedChatSnapshot = {
  messages: UnifiedChatMessage[];
  unreadCount: number;
  preferredCcChatId: string | null;
  supportConversationId: string | null;
  supportStatus: SupportConversationStatus;
  supportAgentName: string | null;
  ccAgentName: string | null;
  ccRoomIds: string[];
  closedNotice: OwnerClosedNotice | null;
};

export type SendChatMessageResult = {
  source: "support" | "cc";
  threadId: string;
  messageId: string;
};

export type UnifiedChatSubscription = {
  cleanup: () => void;
  ensureSupportThread: (conversationId: string) => void;
  ensureCcThread: (chatId: string) => void;
  setPanelOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
};

type ApiSupportConversation = {
  conversationId: string;
  status: SupportConversationStatus;
  agentName: string | null;
  unreadForCustomer: number;
};

type FirestoreSupportConversation = {
  conversationId: string;
  status: SupportConversationStatus;
  agentName: string | null;
  unreadForCustomer: number;
  closedBy: "agent" | "customer" | "system" | null;
  closedAt: number | null;
  updatedAt: number;
};

function mapFirestoreSupportConversation(
  doc: { id: string; data: () => Record<string, unknown> },
): FirestoreSupportConversation {
  const data = doc.data();
  const status = data.status;
  return {
    conversationId: doc.id,
    status:
      status === "waiting" || status === "connected" || status === "closed"
        ? status
        : "waiting",
    agentName:
      typeof data.agentName === "string" && data.agentName.trim()
        ? data.agentName.trim()
        : null,
    unreadForCustomer:
      typeof data.unreadForCustomer === "number" ? data.unreadForCustomer : 0,
    closedBy:
      data.closedBy === "agent" ||
      data.closedBy === "customer" ||
      data.closedBy === "system"
        ? data.closedBy
        : null,
    closedAt: toMillis(data.closedAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function resolveOwnerSupportState(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  pinnedConversationId: string | null,
  previousClosedNotice: OwnerClosedNotice | null,
): {
  conversation: ApiSupportConversation | null;
  closedNotice: OwnerClosedNotice | null;
  closedJustNow: boolean;
} {
  const mapped = docs.map(mapFirestoreSupportConversation);

  let conversation: ApiSupportConversation | null = null;

  if (pinnedConversationId) {
    const pinned = mapped.find((row) => row.conversationId === pinnedConversationId);
    if (
      pinned &&
      (pinned.status === "waiting" || pinned.status === "connected")
    ) {
      conversation = {
        conversationId: pinned.conversationId,
        status: pinned.status,
        agentName: pinned.agentName,
        unreadForCustomer: pinned.unreadForCustomer,
      };
    }
  }

  if (!conversation) {
    const open = mapped
      .filter(
        (row) => row.status === "waiting" || row.status === "connected",
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const connected = open.find((row) => row.status === "connected");
    const chosen = connected ?? open[0];
    if (chosen) {
      conversation = {
        conversationId: chosen.conversationId,
        status: chosen.status,
        agentName: chosen.agentName,
        unreadForCustomer: chosen.unreadForCustomer,
      };
    }
  }

  if (conversation) {
    return { conversation, closedNotice: null, closedJustNow: false };
  }

  const latestAgentClosed = mapped
    .filter((row) => row.status === "closed" && row.closedBy === "agent")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const closedNotice = latestAgentClosed
    ? {
        message: latestAgentClosed.agentName
          ? `Chat closed by ${latestAgentClosed.agentName}`
          : "Chat closed by agent",
        agentName: latestAgentClosed.agentName,
        closedAt: latestAgentClosed.closedAt,
      }
    : null;

  const closedJustNow =
    closedNotice !== null &&
    closedNotice.closedAt !== previousClosedNotice?.closedAt;

  return { conversation, closedNotice, closedJustNow };
}

function mapFirestoreSupportMessage(
  conversationId: string,
  doc: { id: string; data: () => Record<string, unknown> },
): UnifiedChatMessage {
  const data = doc.data();
  const sender =
    data.sender === "customer" ||
    data.sender === "agent" ||
    data.sender === "system"
      ? data.sender
      : "customer";
  return {
    id: doc.id,
    source: "support",
    threadId: conversationId,
    text: typeof data.message === "string" ? data.message : "",
    sender,
    senderName:
      typeof data.senderName === "string" ? data.senderName : "Support",
    timestamp: toMillis(data.timestamp),
  };
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Date.now();
}

function sortDocsByUpdatedAt<T extends { updatedAt?: unknown }>(
  docs: Array<{ id: string; data: () => T }>,
): Array<{ id: string; data: T }> {
  return docs
    .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
    .sort(
      (a, b) =>
        toMillis(b.data.updatedAt) - toMillis(a.data.updatedAt),
    );
}

async function authHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function clearSupportMessages(state: {
  messages: Map<string, UnifiedChatMessage>;
}) {
  for (const key of [...state.messages.keys()]) {
    if (key.startsWith("support:")) {
      state.messages.delete(key);
    }
  }
}

function clearPanelMessages(state: {
  messages: Map<string, UnifiedChatMessage>;
}) {
  state.messages.clear();
}

export function subscribeUnifiedWorkshopChat(
  uid: string,
  options: {
    panelOpen: boolean;
    onUpdate: (snapshot: UnifiedChatSnapshot) => void;
  },
): UnifiedChatSubscription {
  const unsubs: Unsubscribe[] = [];
  let panelOpen = options.panelOpen;
  let pinnedSupportConversationId: string | null = null;
  let panelSessionStartedAt: number | null = null;

  const state = {
    supportConversationId: null as string | null,
    supportStatus: null as SupportConversationStatus,
    supportAgentName: null as string | null,
    ccAgentName: null as string | null,
    ccRoomIds: [] as string[],
    preferredCcChatId: null as string | null,
    closedNotice: null as OwnerClosedNotice | null,
    supportUnread: 0,
    ccUnread: 0,
    messages: new Map<string, UnifiedChatMessage>(),
    messageUnsubs: new Map<string, Unsubscribe>(),
  };

  function emit() {
    const messages = [...state.messages.values()].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    options.onUpdate({
      messages,
      unreadCount: panelOpen
        ? 0
        : state.supportUnread + state.ccUnread,
      preferredCcChatId: state.preferredCcChatId,
      supportConversationId: state.supportConversationId,
      supportStatus: state.supportStatus,
      supportAgentName: state.supportAgentName,
      ccAgentName: state.ccAgentName,
      ccRoomIds: state.ccRoomIds,
      closedNotice: state.closedNotice,
    });
  }

  function detachCcMessageListeners() {
    for (const [key, unsub] of state.messageUnsubs.entries()) {
      if (!key.startsWith("cc:")) continue;
      unsub();
      state.messageUnsubs.delete(key);
    }
    for (const key of [...state.messages.keys()]) {
      if (key.startsWith("cc:")) {
        state.messages.delete(key);
      }
    }
  }

  function attachCcMessages(chatId: string) {
    const key = `cc:${chatId}`;
    if (state.messageUnsubs.has(key)) return;

    const messagesRef = collection(
      db,
      CC_DIRECT_CHATS_COLLECTION,
      chatId,
      "messages",
    );

    const unsub = onSnapshot(
      query(messagesRef, limit(100)),
      (snap) => {
        for (const existingKey of [...state.messages.keys()]) {
          if (existingKey.startsWith(`cc:${chatId}:`)) {
            state.messages.delete(existingKey);
          }
        }
        const sessionCutoff =
          panelSessionStartedAt !== null
            ? panelSessionStartedAt - 1000
            : null;
        const mapped = snap.docs
          .map((messageDoc) => {
            const data = messageDoc.data();
            const timestamp = toMillis(data.createdAt);
            if (sessionCutoff !== null && timestamp < sessionCutoff) {
              return null;
            }
            const senderRole =
              typeof data.senderRole === "string" ? data.senderRole : "";
            const messageKind =
              data.messageKind === "system" ? "system" : "user";
            const sender: UnifiedChatMessage["sender"] =
              messageKind === "system"
                ? "system"
                : senderRole === "call_center"
                  ? "agent"
                  : "customer";
            const agentLabel =
              state.ccAgentName?.trim() || "Reception";
            return {
              key: `cc:${chatId}:${messageDoc.id}`,
              message: {
                id: messageDoc.id,
                source: "cc" as const,
                threadId: chatId,
                text: typeof data.text === "string" ? data.text : "",
                sender,
                senderName: sender === "agent" ? agentLabel : "You",
                timestamp,
              },
            };
          })
          .filter(
            (item): item is NonNullable<typeof item> => item !== null,
          );
        mapped.sort((a, b) => a.message.timestamp - b.message.timestamp);
        for (const item of mapped) {
          state.messages.set(item.key, item.message);
        }
        emit();
      },
      (error) => {
        console.error("[chat] cc messages listener failed:", error);
      },
    );
    state.messageUnsubs.set(key, unsub);
  }

  function syncCcMessageListeners() {
    if (!panelOpen) {
      detachCcMessageListeners();
      return;
    }
    detachCcMessageListeners();
    if (state.preferredCcChatId) {
      attachCcMessages(state.preferredCcChatId);
    }
  }

  function detachSupportMessageListeners() {
    for (const [key, unsub] of state.messageUnsubs.entries()) {
      if (!key.startsWith("support:")) continue;
      unsub();
      state.messageUnsubs.delete(key);
    }
    clearSupportMessages(state);
  }

  function attachSupportMessages(conversationId: string) {
    const key = `support:${conversationId}`;
    if (state.messageUnsubs.has(key)) return;

    const messagesRef = collection(
      db,
      CONVERSATIONS_COLLECTION,
      conversationId,
      "messages",
    );

    const unsub = onSnapshot(
      query(messagesRef, limit(100)),
      (snap) => {
        for (const existingKey of [...state.messages.keys()]) {
          if (existingKey.startsWith(`support:${conversationId}:`)) {
            state.messages.delete(existingKey);
          }
        }

        const sessionCutoff =
          panelSessionStartedAt !== null
            ? panelSessionStartedAt - 1000
            : null;

        const mapped = snap.docs
          .map((messageDoc) => {
            const message = mapFirestoreSupportMessage(
              conversationId,
              messageDoc,
            );
            if (
              sessionCutoff !== null &&
              message.timestamp < sessionCutoff
            ) {
              return null;
            }
            return {
              key: `support:${conversationId}:${message.id}`,
              message,
            };
          })
          .filter(
            (item): item is NonNullable<typeof item> => item !== null,
          );

        mapped.sort((a, b) => a.message.timestamp - b.message.timestamp);
        for (const item of mapped) {
          state.messages.set(item.key, item.message);
        }
        emit();
      },
      (error) => {
        console.error("[chat] support messages listener failed:", error);
      },
    );
    state.messageUnsubs.set(key, unsub);
  }

  function syncSupportMessageListeners() {
    if (!panelOpen || !state.supportConversationId) {
      detachSupportMessageListeners();
      return;
    }
    detachSupportMessageListeners();
    attachSupportMessages(state.supportConversationId);
  }

  function applySupportConversationDocs(
    docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  ) {
    const { conversation, closedNotice, closedJustNow } =
      resolveOwnerSupportState(
        docs,
        pinnedSupportConversationId,
        state.closedNotice,
      );

    if (!conversation?.conversationId) {
      pinnedSupportConversationId = null;
      state.supportConversationId = null;
      state.supportStatus = null;
      state.supportAgentName = null;
      state.supportUnread = 0;
      state.closedNotice = closedNotice;
      detachSupportMessageListeners();
      if (closedJustNow && panelOpen) {
        panelSessionStartedAt = Date.now();
      }
      emit();
      return;
    }

    state.closedNotice = null;
    pinnedSupportConversationId = conversation.conversationId;
    state.supportConversationId = conversation.conversationId;
    state.supportStatus = conversation.status;
    state.supportAgentName = conversation.agentName?.trim() || null;
    state.supportUnread = conversation.unreadForCustomer;
    syncSupportMessageListeners();
    emit();
  }

  const supportConversationsQuery = query(
    collection(db, CONVERSATIONS_COLLECTION),
    where("userId", "==", uid),
    limit(50),
  );

  unsubs.push(
    onSnapshot(
      supportConversationsQuery,
      (snap) => {
        applySupportConversationDocs(snap.docs);
      },
      (error) => {
        console.error("[chat] support conversations listener failed:", error);
        emit();
      },
    ),
  );

  const ccQuery = query(
    collection(db, CC_DIRECT_CHATS_COLLECTION),
    where("tenantUserUid", "==", uid),
    limit(50),
  );

  unsubs.push(
    onSnapshot(
      ccQuery,
      (snap) => {
        const rooms = sortDocsByUpdatedAt(snap.docs);

        state.ccRoomIds = rooms.map((room) => room.id);

        const active = rooms.find(
          (room) =>
            room.data.sessionStatus === "open" &&
            (room.data.queueStatus === "active" || room.data.agentUid),
        );
        state.preferredCcChatId = active?.id ?? rooms[0]?.id ?? null;
        state.ccAgentName =
          typeof active?.data.agentName === "string" &&
          active.data.agentName.trim()
            ? active.data.agentName.trim()
            : typeof rooms[0]?.data.agentName === "string"
              ? rooms[0].data.agentName.trim() || null
              : null;

        state.ccUnread = rooms.reduce((sum, room) => {
          return sum + (room.data.unreadForTenant === true ? 1 : 0);
        }, 0);

        syncCcMessageListeners();
        emit();
      },
      (error) => {
        console.error("[chat] cc_direct_chats listener failed:", error);
        emit();
      },
    ),
  );

  function ensureSupportThread(conversationId: string) {
    pinnedSupportConversationId = conversationId;
    state.supportConversationId = conversationId;
    if (state.supportStatus === "closed" || !state.supportStatus) {
      state.supportStatus = "waiting";
    }
    state.supportAgentName = null;
    state.closedNotice = null;
    syncSupportMessageListeners();
    emit();
  }

  function ensureCcThread(chatId: string) {
    if (!state.ccRoomIds.includes(chatId)) {
      state.ccRoomIds = [chatId, ...state.ccRoomIds];
    }
    state.preferredCcChatId = chatId;
    attachCcMessages(chatId);
    emit();
  }

  return {
    cleanup: () => {
      for (const unsub of unsubs) unsub();
      detachCcMessageListeners();
      detachSupportMessageListeners();
    },
    ensureSupportThread,
    ensureCcThread,
    setPanelOpen(open: boolean) {
      panelOpen = open;
      if (open) {
        panelSessionStartedAt = Date.now();
        clearPanelMessages(state);
        detachCcMessageListeners();
        syncSupportMessageListeners();
        syncCcMessageListeners();
      } else {
        panelSessionStartedAt = null;
        clearPanelMessages(state);
        detachCcMessageListeners();
        detachSupportMessageListeners();
      }
      emit();
    },
    refresh: async () => {
      emit();
    },
  };
}

export async function sendUnifiedWorkshopChatMessage(
  text: string,
  preferredCcChatId: string | null,
): Promise<SendChatMessageResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Message is required.");
  }

  const headers = await authHeaders();

  if (preferredCcChatId) {
    const res = await fetch(
      `/api/chat/cc-direct/rooms/${encodeURIComponent(preferredCcChatId)}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: trimmed }),
      },
    );
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      messageId?: string;
    };
    if (!res.ok || !data.ok || !data.messageId) {
      throw new Error(data.error ?? "Could not send message.");
    }
    return {
      source: "cc",
      threadId: preferredCcChatId,
      messageId: data.messageId,
    };
  }

  const res = await fetch("/api/chat/conversations/owner/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: trimmed }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    conversationId?: string;
    messageId?: string;
  };
  if (!res.ok || !data.ok || !data.conversationId || !data.messageId) {
    throw new Error(data.error ?? "Could not send message.");
  }
  return {
    source: "support",
    threadId: data.conversationId,
    messageId: data.messageId,
  };
}

export async function markCcRoomRead(chatId: string): Promise<void> {
  const headers = await authHeaders();
  await fetch(`/api/chat/cc-direct/rooms/${encodeURIComponent(chatId)}/read`, {
    method: "POST",
    headers,
  });
}

export async function markAllCcRoomsRead(ccRoomIds: string[]): Promise<void> {
  if (ccRoomIds.length === 0) return;
  const headers = await authHeaders();
  await Promise.all(
    ccRoomIds.map((chatId) =>
      fetch(`/api/chat/cc-direct/rooms/${encodeURIComponent(chatId)}/read`, {
        method: "POST",
        headers,
      }),
    ),
  );
}

export async function markCustomerConversationRead(
  conversationId: string,
): Promise<void> {
  const headers = await authHeaders();
  await fetch(
    `/api/chat/conversations/owner/${encodeURIComponent(conversationId)}/read`,
    { method: "POST", headers },
  );
}
