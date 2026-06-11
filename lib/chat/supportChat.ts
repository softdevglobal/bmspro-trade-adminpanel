import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { getCallCenterAgentProfile, getUserProfile } from "@/lib/chat/auth";
import { fanOutToActiveAgents, sendChatPush } from "@/lib/chat/push";
import { sortByUpdatedAtDesc } from "@/lib/chat/sort";
import {
  CALL_CENTER_AGENTS_COLLECTION,
  CONVERSATIONS_COLLECTION,
  type SupportConversation,
  type SupportMessage,
  type SupportMessageSender,
} from "@/lib/chat/types";
import {
  FieldValue,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function mapConversationDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): SupportConversation {
  const data = doc.data() ?? {};
  return {
    conversationId: doc.id,
    userId: typeof data.userId === "string" ? data.userId : "",
    userName: typeof data.userName === "string" ? data.userName : "",
    userEmail: typeof data.userEmail === "string" ? data.userEmail : "",
    userPhone: typeof data.userPhone === "string" ? data.userPhone : "",
    role: typeof data.role === "string" ? data.role : "",
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : null,
    status:
      data.status === "waiting" ||
      data.status === "connected" ||
      data.status === "closed"
        ? data.status
        : "waiting",
    agentId: typeof data.agentId === "string" ? data.agentId : null,
    agentName: typeof data.agentName === "string" ? data.agentName : null,
    agentEmail: typeof data.agentEmail === "string" ? data.agentEmail : null,
    lastMessage: typeof data.lastMessage === "string" ? data.lastMessage : "",
    lastMessageAt: toMillis(data.lastMessageAt),
    lastSender:
      data.lastSender === "customer" ||
      data.lastSender === "agent" ||
      data.lastSender === "system"
        ? data.lastSender
        : null,
    unreadForAgent:
      typeof data.unreadForAgent === "number" ? data.unreadForAgent : 0,
    unreadForCustomer:
      typeof data.unreadForCustomer === "number" ? data.unreadForCustomer : 0,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    claimedAt: toMillis(data.claimedAt),
    closedAt: toMillis(data.closedAt),
    closedBy:
      data.closedBy === "agent" ||
      data.closedBy === "customer" ||
      data.closedBy === "system"
        ? data.closedBy
        : null,
  };
}

function mapMessageDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): SupportMessage {
  const data = doc.data() ?? {};
  return {
    messageId: doc.id,
    sender:
      data.sender === "customer" ||
      data.sender === "agent" ||
      data.sender === "system"
        ? data.sender
        : "customer",
    senderId: typeof data.senderId === "string" ? data.senderId : "",
    senderName: typeof data.senderName === "string" ? data.senderName : "",
    message: typeof data.message === "string" ? data.message : "",
    timestamp: toMillis(data.timestamp),
    readByAgent: data.readByAgent === true,
    readByCustomer: data.readByCustomer === true,
  };
}

async function findOpenConversation(
  userId: string,
): Promise<QueryDocumentSnapshot | null> {
  const snapshot = await adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .where("userId", "==", userId)
    .where("status", "in", ["waiting", "connected"])
    .limit(50)
    .get();
  if (snapshot.empty) return null;

  const sorted = sortByUpdatedAtDesc(snapshot.docs.map(mapConversationDoc));
  const connected = sorted.find((conversation) => conversation.status === "connected");
  const chosen = connected ?? sorted[0];
  if (!chosen) return null;

  return (
    snapshot.docs.find((doc) => doc.id === chosen.conversationId) ?? null
  );
}

async function appendSystemMessage(
  conversationId: string,
  message: string,
): Promise<void> {
  const ref = adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .doc(conversationId)
    .collection("messages")
    .doc();
  await ref.set({
    sender: "system",
    senderId: "system",
    senderName: "System",
    message,
    timestamp: FieldValue.serverTimestamp(),
    readByAgent: false,
    readByCustomer: false,
  });
}

export async function getCustomerConversation(
  userId: string,
): Promise<SupportConversation | null> {
  const open = await findOpenConversation(userId);
  if (open) return mapConversationDoc(open);
  // Only return active (waiting/connected) threads — closed history must not
  // appear when the owner starts a fresh conversation.
  return null;
}

export async function customerSendMessage(
  userId: string,
  messageText: string,
): Promise<{ conversationId: string; messageId: string; created: boolean }> {
  const trimmed = messageText.trim();
  if (!trimmed) {
    throw new Error("Message is required.");
  }

  const profile = await getUserProfile(userId);
  const displayName = profile.fullName || profile.email || "Customer";
  let conversationRef = await findOpenConversation(userId);
  let created = false;

  if (!conversationRef) {
    const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({
      conversationId: ref.id,
      userId,
      userName: displayName,
      userEmail: profile.email,
      userPhone: profile.phone,
      role: profile.role,
      ownerUid: profile.ownerUid,
      status: "waiting",
      agentId: null,
      agentName: null,
      agentEmail: null,
      lastMessage: trimmed,
      lastMessageAt: now,
      lastSender: "customer",
      unreadForAgent: 1,
      unreadForCustomer: 0,
      createdAt: now,
      updatedAt: now,
      claimedAt: null,
      closedAt: null,
      closedBy: null,
    });
    conversationRef = (await ref.get()) as QueryDocumentSnapshot;
    created = true;
  }

  const conversationId = conversationRef.id;
  const messageRef = adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .doc(conversationId)
    .collection("messages")
    .doc();

  const now = FieldValue.serverTimestamp();
  await messageRef.set({
    sender: "customer",
    senderId: userId,
    senderName: displayName,
    message: trimmed,
    timestamp: now,
    readByAgent: false,
    readByCustomer: true,
  });

  const convData = conversationRef.data() ?? {};
  const unreadForAgent =
    (typeof convData.unreadForAgent === "number"
      ? convData.unreadForAgent
      : 0) + 1;

  await adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId).update({
    userName: displayName,
    userEmail: profile.email,
    userPhone: profile.phone,
    role: profile.role,
    ownerUid: profile.ownerUid,
    lastMessage: trimmed,
    lastMessageAt: now,
    lastSender: "customer",
    unreadForAgent,
    updatedAt: now,
  });

  const agentId =
    typeof convData.agentId === "string" ? convData.agentId : null;
  const pushData = {
    type: "support_chat",
    event: "message",
    conversationId,
    messageId: messageRef.id,
  };

  if (agentId) {
    await sendChatPush({
      targetUid: agentId,
      title: "New support message",
      body: trimmed,
      data: pushData,
    });
  } else {
    await fanOutToActiveAgents("New support queue message", trimmed, pushData);
  }

  return { conversationId, messageId: messageRef.id, created };
}

export async function markCustomerConversationRead(
  userId: string,
  conversationId: string,
): Promise<void> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");
  const data = snap.data() ?? {};
  if (data.userId !== userId) throw new Error("Access denied.");

  const messages = await ref
    .collection("messages")
    .where("sender", "==", "agent")
    .where("readByCustomer", "==", false)
    .limit(100)
    .get();

  const batch = adminDb.batch();
  for (const doc of messages.docs) {
    batch.update(doc.ref, { readByCustomer: true });
  }
  batch.update(ref, { unreadForCustomer: 0, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

export async function listAgentConversations(
  agentId: string,
  queueLimit = 30,
  mineLimit = 30,
): Promise<{ queue: SupportConversation[]; mine: SupportConversation[] }> {
  const fetchCap = (limit: number) => Math.min(Math.max(limit * 5, limit), 200);

  const [queueSnap, mineSnap] = await Promise.all([
    adminDb
      .collection(CONVERSATIONS_COLLECTION)
      .where("status", "==", "waiting")
      .limit(fetchCap(queueLimit))
      .get(),
    adminDb
      .collection(CONVERSATIONS_COLLECTION)
      .where("agentId", "==", agentId)
      .limit(fetchCap(mineLimit))
      .get(),
  ]);

  const queue = sortByUpdatedAtDesc(queueSnap.docs.map(mapConversationDoc)).slice(
    0,
    queueLimit,
  );
  const mine = sortByUpdatedAtDesc(
    mineSnap.docs
      .map(mapConversationDoc)
      .filter((conversation) => conversation.status === "connected"),
  ).slice(0, mineLimit);

  return { queue, mine };
}

export async function agentClaimConversation(
  agentId: string,
  conversationId: string,
): Promise<SupportConversation> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");

  const data = snap.data() ?? {};
  if (data.status !== "waiting") {
    throw new Error("Conversation is not available to claim.");
  }

  const agent = await getCallCenterAgentProfile(agentId);
  const now = FieldValue.serverTimestamp();
  const agentName = agent.fullName || agent.email || "Agent";

  await ref.update({
    status: "connected",
    agentId,
    agentName,
    agentEmail: agent.email,
    claimedAt: now,
    updatedAt: now,
  });

  await appendSystemMessage(
    conversationId,
    `You are connected with ${agentName}`,
  );

  const userId = typeof data.userId === "string" ? data.userId : "";
  if (userId) {
    await sendChatPush({
      targetUid: userId,
      title: "Support connected",
      body: `You are connected with ${agentName}`,
      data: {
        type: "support_chat",
        event: "claimed",
        conversationId,
      },
    });
  }

  await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .doc(agentId)
    .set(
      {
        uid: agentId,
        fullName: agentName,
        email: agent.email,
        activeChatCount: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true },
    );

  const updated = await ref.get();
  return mapConversationDoc(updated);
}

export async function getConversationMessages(
  conversationId: string,
  limit = 40,
  beforeMessageId?: string | null,
): Promise<SupportMessage[]> {
  const snapshot = await adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .doc(conversationId)
    .collection("messages")
    .limit(Math.min(Math.max(limit, 40), 200))
    .get();

  let messages = [...snapshot.docs.map(mapMessageDoc)].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
  );

  if (beforeMessageId) {
    const cursorIndex = messages.findIndex(
      (message) => message.messageId === beforeMessageId,
    );
    if (cursorIndex > 0) {
      messages = messages.slice(0, cursorIndex);
    }
  }

  if (messages.length > limit) {
    messages = messages.slice(messages.length - limit);
  }

  return messages;
}

export async function customerGetConversationMessages(
  userId: string,
  conversationId: string,
  limit = 100,
): Promise<SupportMessage[]> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");

  const data = snap.data() ?? {};
  if (data.userId !== userId) throw new Error("Access denied.");

  return getConversationMessages(conversationId, limit);
}

export async function agentSendMessage(
  agentId: string,
  conversationId: string,
  messageText: string,
): Promise<{ messageId: string }> {
  const trimmed = messageText.trim();
  if (!trimmed) throw new Error("Message is required.");

  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");

  const data = snap.data() ?? {};
  if (data.status !== "connected" || data.agentId !== agentId) {
    throw new Error("You are not assigned to this conversation.");
  }

  const agent = await getCallCenterAgentProfile(agentId);
  const agentName = agent.fullName || agent.email || "Agent";
  const messageRef = ref.collection("messages").doc();
  const now = FieldValue.serverTimestamp();

  await messageRef.set({
    sender: "agent" as SupportMessageSender,
    senderId: agentId,
    senderName: agentName,
    message: trimmed,
    timestamp: now,
    readByAgent: true,
    readByCustomer: false,
  });

  const unreadForCustomer =
    (typeof data.unreadForCustomer === "number"
      ? data.unreadForCustomer
      : 0) + 1;

  await ref.update({
    lastMessage: trimmed,
    lastMessageAt: now,
    lastSender: "agent",
    unreadForCustomer,
    updatedAt: now,
  });

  const userId = typeof data.userId === "string" ? data.userId : "";
  if (userId) {
    await sendChatPush({
      targetUid: userId,
      title: agentName,
      body: trimmed,
      data: {
        type: "support_chat",
        event: "message",
        conversationId,
        messageId: messageRef.id,
      },
    });
  }

  return { messageId: messageRef.id };
}

export async function agentMarkConversationRead(
  agentId: string,
  conversationId: string,
): Promise<void> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");
  const data = snap.data() ?? {};
  if (data.agentId !== agentId) throw new Error("Access denied.");

  const messages = await ref
    .collection("messages")
    .where("sender", "==", "customer")
    .where("readByAgent", "==", false)
    .limit(100)
    .get();

  const batch = adminDb.batch();
  for (const doc of messages.docs) {
    batch.update(doc.ref, { readByAgent: true });
  }
  batch.update(ref, { unreadForAgent: 0, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

export async function agentCloseConversation(
  agentId: string,
  conversationId: string,
  farewellMessage?: string | null,
): Promise<void> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");
  const data = snap.data() ?? {};
  if (data.agentId !== agentId) throw new Error("Access denied.");

  const now = FieldValue.serverTimestamp();
  await ref.update({
    status: "closed",
    closedAt: now,
    closedBy: "agent",
    updatedAt: now,
  });

  if (farewellMessage?.trim()) {
    const messageRef = ref.collection("messages").doc();
    await messageRef.set({
      sender: "agent",
      senderId: agentId,
      senderName:
        typeof data.agentName === "string" ? data.agentName : "Agent",
      message: farewellMessage.trim(),
      timestamp: now,
      readByAgent: true,
      readByCustomer: false,
    });
  }

  await appendSystemMessage(conversationId, "Chat ended");

  await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .doc(agentId)
    .set(
      { activeChatCount: FieldValue.increment(-1), updatedAt: now },
      { merge: true },
    );
}

export async function agentTransferConversation(
  agentId: string,
  conversationId: string,
  targetAgentUid: string,
): Promise<void> {
  if (agentId === targetAgentUid) {
    throw new Error("Cannot transfer to yourself.");
  }

  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc(conversationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Conversation not found.");
  const data = snap.data() ?? {};
  if (data.agentId !== agentId) throw new Error("Access denied.");

  const target = await getCallCenterAgentProfile(targetAgentUid);
  const targetName = target.fullName || target.email || "Agent";
  const now = FieldValue.serverTimestamp();

  await ref.update({
    agentId: targetAgentUid,
    agentName: targetName,
    agentEmail: target.email,
    updatedAt: now,
  });

  await appendSystemMessage(
    conversationId,
    `Chat transferred to ${targetName}`,
  );
}

export async function setAgentPresence(
  agentId: string,
  online: boolean,
): Promise<void> {
  const profile = await getCallCenterAgentProfile(agentId);
  await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .doc(agentId)
    .set(
      {
        uid: agentId,
        fullName: profile.fullName,
        email: profile.email,
        isOnline: online,
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function registerAgentFcmToken(
  agentId: string,
  token: string,
  platform?: string | null,
): Promise<void> {
  const profile = await getCallCenterAgentProfile(agentId);
  await adminDb
    .collection(CALL_CENTER_AGENTS_COLLECTION)
    .doc(agentId)
    .set(
      {
        uid: agentId,
        fullName: profile.fullName,
        email: profile.email,
        fcmToken: token.trim(),
        fcmPlatform: platform ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
