"use client";

import { CC_DIRECT_CHATS_COLLECTION } from "@/lib/chat/types";
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

export type UnifiedChatSnapshot = {
  messages: UnifiedChatMessage[];
  unreadCount: number;
  preferredCcChatId: string | null;
  supportConversationId: string | null;
  supportStatus: SupportConversationStatus;
  supportAgentName: string | null;
  ccAgentName: string | null;
  ccRoomIds: string[];
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

type ApiSupportMessage = {
  messageId: string;
  sender: "customer" | "agent" | "system";
  senderName: string;
  message: string;
  timestamp: number | null;
};

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

function mapApiSupportMessage(
  conversationId: string,
  message: ApiSupportMessage,
): UnifiedChatMessage {
  return {
    id: message.messageId,
    source: "support",
    threadId: conversationId,
    text: message.message,
    sender: message.sender,
    senderName: message.senderName,
    timestamp: message.timestamp ?? Date.now(),
  };
}

function replaceSupportMessages(
  state: {
    messages: Map<string, UnifiedChatMessage>;
  },
  conversationId: string,
  apiMessages: ApiSupportMessage[],
) {
  for (const key of [...state.messages.keys()]) {
    if (key.startsWith("support:")) {
      state.messages.delete(key);
    }
  }
  for (const message of apiMessages) {
    const unified = mapApiSupportMessage(conversationId, message);
    state.messages.set(
      `support:${conversationId}:${unified.id}`,
      unified,
    );
  }
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
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let refreshInFlight = false;
  let refreshQueued = false;
  let pinnedSupportConversationId: string | null = null;

  const state = {
    supportConversationId: null as string | null,
    supportStatus: null as SupportConversationStatus,
    supportAgentName: null as string | null,
    ccAgentName: null as string | null,
    ccRoomIds: [] as string[],
    preferredCcChatId: null as string | null,
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
        const mapped = snap.docs.map((messageDoc) => {
          const data = messageDoc.data();
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
              timestamp: toMillis(data.createdAt),
            },
          };
        });
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
    detachCcMessageListeners();
    for (const chatId of state.ccRoomIds) {
      attachCcMessages(chatId);
    }
  }

  async function refreshSupportFromApi() {
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }
    refreshInFlight = true;
    try {
      const headers = await authHeaders();
      const conversationRes = await fetch("/api/chat/conversations/owner", {
        headers,
        cache: "no-store",
      });
      const conversationData = (await conversationRes.json()) as {
        ok?: boolean;
        conversation?: ApiSupportConversation | null;
        error?: string;
      };

      if (!conversationRes.ok || !conversationData.ok) {
        console.error(
          "[chat] conversation fetch failed:",
          conversationData.error ?? conversationRes.status,
        );
        return;
      }

      const conversation = conversationData.conversation ?? null;

      if (!conversation?.conversationId) {
        pinnedSupportConversationId = null;
        state.supportConversationId = null;
        state.supportStatus = null;
        state.supportAgentName = null;
        state.supportUnread = 0;
        replaceSupportMessages(state, "", []);
        emit();
        return;
      }

      const conversationId = conversation.conversationId;
      pinnedSupportConversationId = conversationId;
      state.supportConversationId = conversationId;
      state.supportStatus = conversation.status;
      state.supportAgentName = conversation.agentName?.trim() || null;
      state.supportUnread =
        typeof conversation.unreadForCustomer === "number"
          ? conversation.unreadForCustomer
          : 0;

      const messagesRes = await fetch(
        `/api/chat/conversations/owner/${encodeURIComponent(conversationId)}/messages?limit=100`,
        { headers, cache: "no-store" },
      );
      const messagesData = (await messagesRes.json()) as {
        ok?: boolean;
        messages?: ApiSupportMessage[];
        error?: string;
      };

      if (!messagesRes.ok || !messagesData.ok || !messagesData.messages) {
        console.error(
          "[chat] messages fetch failed:",
          messagesData.error ?? messagesRes.status,
        );
        emit();
        return;
      }

      replaceSupportMessages(
        state,
        conversationId,
        messagesData.messages,
      );
      emit();
    } catch (error) {
      console.error("[chat] API refresh failed:", error);
    } finally {
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refreshSupportFromApi();
      }
    }
  }

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(
      () => {
        void refreshSupportFromApi();
      },
      panelOpen ? 2000 : 5000,
    );
  }

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

  void refreshSupportFromApi();
  schedulePoll();

  function ensureSupportThread(conversationId: string) {
    pinnedSupportConversationId = conversationId;
    state.supportConversationId = conversationId;
    if (state.supportStatus === "closed" || !state.supportStatus) {
      state.supportStatus = "waiting";
    }
    state.supportAgentName = null;
    emit();
    void refreshSupportFromApi();
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
      if (pollTimer) clearInterval(pollTimer);
      for (const unsub of unsubs) unsub();
      detachCcMessageListeners();
    },
    ensureSupportThread,
    ensureCcThread,
    setPanelOpen(open: boolean) {
      panelOpen = open;
      schedulePoll();
      emit();
      if (open) {
        void refreshSupportFromApi();
      }
    },
    refresh: refreshSupportFromApi,
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

export async function markAllCcRoomsRead(ccRoomIds: string[]): Promise<void> {
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
