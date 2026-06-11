import "server-only";

import { randomBytes } from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import { getCallCenterAgentProfile, getUserProfile } from "@/lib/chat/auth";
import { sendChatPush } from "@/lib/chat/push";
import { sortByUpdatedAtDesc } from "@/lib/chat/sort";
import {
  CALL_CENTER_AGENTS_COLLECTION,
  CC_DIRECT_CHATS_COLLECTION,
  type CcDirectChat,
  type CcDirectMessage,
} from "@/lib/chat/types";
import {
  FieldValue,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

export function buildCcChatId(uidA: string, uidB: string): string {
  const sorted = [uidA, uidB].sort();
  return `cc_${sorted[0]}_${sorted[1]}`;
}

export function buildCcQueueRequestId(): string {
  return `cc_req_${randomBytes(8).toString("hex")}`;
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function mapCcChatDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): CcDirectChat {
  const data = doc.data() ?? {};
  return {
    chatId: doc.id,
    workshopOwnerUid:
      typeof data.workshopOwnerUid === "string" ? data.workshopOwnerUid : "",
    tenantUserUid:
      typeof data.tenantUserUid === "string" ? data.tenantUserUid : "",
    tenantRole: typeof data.tenantRole === "string" ? data.tenantRole : "",
    tenantName: typeof data.tenantName === "string" ? data.tenantName : "",
    agentUid: typeof data.agentUid === "string" ? data.agentUid : "",
    agentName: typeof data.agentName === "string" ? data.agentName : "",
    participantIds: Array.isArray(data.participantIds)
      ? data.participantIds.filter((id): id is string => typeof id === "string")
      : [],
    queueStatus:
      data.queueStatus === "pending" || data.queueStatus === "active"
        ? data.queueStatus
        : "active",
    sessionStatus:
      data.sessionStatus === "open" || data.sessionStatus === "closed"
        ? data.sessionStatus
        : "open",
    lastMessageText:
      typeof data.lastMessageText === "string" ? data.lastMessageText : "",
    lastMessageAt: toMillis(data.lastMessageAt),
    lastSenderId:
      typeof data.lastSenderId === "string" ? data.lastSenderId : "",
    unreadForTenant: data.unreadForTenant === true,
    unreadForAgent: data.unreadForAgent === true,
    chatsReviewed: data.chatsReviewed === true,
    chatsReviewedAt: toMillis(data.chatsReviewedAt),
    chatsReviewedByUid:
      typeof data.chatsReviewedByUid === "string"
        ? data.chatsReviewedByUid
        : null,
    closedAt: toMillis(data.closedAt),
    closedByUid:
      typeof data.closedByUid === "string" ? data.closedByUid : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function mapCcMessageDoc(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
): CcDirectMessage {
  const data = doc.data() ?? {};
  return {
    messageId: doc.id,
    senderId: typeof data.senderId === "string" ? data.senderId : "",
    senderRole: typeof data.senderRole === "string" ? data.senderRole : "",
    messageKind:
      data.messageKind === "system" || data.messageKind === "user"
        ? data.messageKind
        : "user",
    text: typeof data.text === "string" ? data.text : "",
    createdAt: toMillis(data.createdAt),
    seenByRecipient: data.seenByRecipient === true,
    readAt: toMillis(data.readAt),
  };
}

async function resolveWorkshopOwnerUid(tenantUid: string): Promise<string> {
  const profile = await getUserProfile(tenantUid);
  if (profile.ownerUid) return profile.ownerUid;
  if (profile.role === "owner") return tenantUid;
  return tenantUid;
}

export async function listActiveCcAgents(): Promise<
  Array<{ id: string; fullName: string; email: string; isOnline: boolean }>
> {
  const agentsSnap = await adminDb
    .collection("users")
    .where("role", "==", "call_center")
    .where("isActive", "==", true)
    .limit(100)
    .get();

  const results = await Promise.all(
    agentsSnap.docs.map(async (doc) => {
      const data = doc.data();
      const presence = await adminDb
        .collection(CALL_CENTER_AGENTS_COLLECTION)
        .doc(doc.id)
        .get();
      const presenceData = presence.data() ?? {};
      return {
        id: doc.id,
        fullName:
          typeof data.fullName === "string" ? data.fullName : "",
        email: typeof data.email === "string" ? data.email : "",
        isOnline: presenceData.isOnline === true,
      };
    }),
  );

  return results;
}

export async function listCcRoomsForTenant(
  tenantUid: string,
  limit = 50,
): Promise<CcDirectChat[]> {
  const snapshot = await adminDb
    .collection(CC_DIRECT_CHATS_COLLECTION)
    .where("tenantUserUid", "==", tenantUid)
    .limit(Math.min(Math.max(limit * 5, limit), 200))
    .get();
  return sortByUpdatedAtDesc(snapshot.docs.map(mapCcChatDoc)).slice(0, limit);
}

export async function createCcRoom(
  tenantUid: string,
  options: { queue?: boolean; agentUid?: string | null },
): Promise<CcDirectChat> {
  const profile = await getUserProfile(tenantUid);
  const tenantName = profile.fullName || profile.email || "User";
  const workshopOwnerUid = await resolveWorkshopOwnerUid(tenantUid);
  const now = FieldValue.serverTimestamp();

  if (options.queue) {
    const chatId = buildCcQueueRequestId();
    const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
    await ref.set({
      chatId,
      workshopOwnerUid,
      tenantUserUid: tenantUid,
      tenantRole: profile.role,
      tenantName,
      agentUid: "",
      agentName: "",
      participantIds: [tenantUid],
      queueStatus: "pending",
      sessionStatus: "open",
      lastMessageText: "",
      lastMessageAt: null,
      lastSenderId: "",
      unreadForTenant: false,
      unreadForAgent: false,
      chatsReviewed: false,
      chatsReviewedAt: null,
      chatsReviewedByUid: null,
      closedAt: null,
      closedByUid: null,
      createdAt: now,
      updatedAt: now,
    });
    const snap = await ref.get();
    return mapCcChatDoc(snap);
  }

  const agentUid = options.agentUid?.trim();
  if (!agentUid) {
    throw new Error("agentUid is required for a direct chat.");
  }

  const agent = await getCallCenterAgentProfile(agentUid);
  const agentName = agent.fullName || agent.email || "Agent";
  const chatId = buildCcChatId(tenantUid, agentUid);
  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);

  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (data.sessionStatus === "closed") {
      await ref.update({
        sessionStatus: "open",
        queueStatus: "active",
        agentUid,
        agentName,
        participantIds: [tenantUid, agentUid],
        closedAt: null,
        closedByUid: null,
        updatedAt: now,
      });
    }
    const snap = await ref.get();
    return mapCcChatDoc(snap);
  }

  await ref.set({
    chatId,
    workshopOwnerUid,
    tenantUserUid: tenantUid,
    tenantRole: profile.role,
    tenantName,
    agentUid,
    agentName,
    participantIds: [tenantUid, agentUid],
    queueStatus: "active",
    sessionStatus: "open",
    lastMessageText: "",
    lastMessageAt: null,
    lastSenderId: "",
    unreadForTenant: false,
    unreadForAgent: false,
    chatsReviewed: false,
    chatsReviewedAt: null,
    chatsReviewedByUid: null,
    closedAt: null,
    closedByUid: null,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await ref.get();
  return mapCcChatDoc(snap);
}

export async function getCcChat(chatId: string): Promise<CcDirectChat | null> {
  const snap = await adminDb
    .collection(CC_DIRECT_CHATS_COLLECTION)
    .doc(chatId)
    .get();
  if (!snap.exists) return null;
  return mapCcChatDoc(snap);
}

export async function getCcMessages(
  chatId: string,
  limit = 40,
  beforeMessageId?: string | null,
): Promise<CcDirectMessage[]> {
  let query = adminDb
    .collection(CC_DIRECT_CHATS_COLLECTION)
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (beforeMessageId) {
    const cursor = await adminDb
      .collection(CC_DIRECT_CHATS_COLLECTION)
      .doc(chatId)
      .collection("messages")
      .doc(beforeMessageId)
      .get();
    if (cursor.exists) {
      query = query.startAfter(cursor);
    }
  }

  const snapshot = await query.get();
  return snapshot.docs.map(mapCcMessageDoc).reverse();
}

export async function appendCcDirectMessage(
  chatId: string,
  senderUid: string,
  senderRole: string,
  text: string,
): Promise<{ messageId: string }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Message is required.");

  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chat not found.");

  const data = snap.data() ?? {};
  const participantIds = Array.isArray(data.participantIds)
    ? data.participantIds
    : [];

  if (!participantIds.includes(senderUid)) {
    throw new Error("Access denied.");
  }

  if (data.sessionStatus === "closed" && senderRole !== "call_center") {
    throw new Error("This chat session is closed.");
  }

  const profile =
    senderRole === "call_center"
      ? await getCallCenterAgentProfile(senderUid)
      : await getUserProfile(senderUid);
  const senderName = profile.fullName || profile.email || "User";
  const messageRef = ref.collection("messages").doc();
  const now = FieldValue.serverTimestamp();
  const isAgent = senderRole === "call_center";

  if (data.sessionStatus === "closed" && isAgent) {
    await ref.update({
      sessionStatus: "open",
      queueStatus: "active",
      closedAt: null,
      closedByUid: null,
      updatedAt: now,
    });
  }

  await messageRef.set({
    messageId: messageRef.id,
    senderId: senderUid,
    senderRole,
    messageKind: "user",
    text: trimmed,
    createdAt: now,
    seenByRecipient: false,
    readAt: null,
  });

  const tenantUid =
    typeof data.tenantUserUid === "string" ? data.tenantUserUid : "";
  const agentUid = typeof data.agentUid === "string" ? data.agentUid : "";

  await ref.update({
    lastMessageText: trimmed,
    lastMessageAt: now,
    lastSenderId: senderUid,
    unreadForTenant: isAgent,
    unreadForAgent: !isAgent,
    updatedAt: now,
  });

  const recipientUid = isAgent ? tenantUid : agentUid;
  if (recipientUid) {
    await sendChatPush({
      targetUid: recipientUid,
      title: senderName,
      body: trimmed,
      data: {
        type: "cc_chat_message",
        chatId,
        senderUid,
        senderName,
      },
    });
  }

  return { messageId: messageRef.id };
}

export async function markCcRoomRead(
  chatId: string,
  readerUid: string,
): Promise<void> {
  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chat not found.");

  const data = snap.data() ?? {};
  const participantIds = Array.isArray(data.participantIds)
    ? data.participantIds
    : [];
  if (!participantIds.includes(readerUid)) {
    throw new Error("Access denied.");
  }

  const isAgent = readerUid === data.agentUid;
  const messages = await ref
    .collection("messages")
    .where("senderId", "!=", readerUid)
    .where("seenByRecipient", "==", false)
    .limit(100)
    .get();

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();
  for (const doc of messages.docs) {
    batch.update(doc.ref, { seenByRecipient: true, readAt: now });
  }

  batch.update(ref, {
    unreadForTenant: isAgent ? data.unreadForTenant : false,
    unreadForAgent: isAgent ? false : data.unreadForAgent,
    updatedAt: now,
  });
  await batch.commit();
}

export async function closeCcRoom(
  chatId: string,
  closedByUid: string,
): Promise<void> {
  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chat not found.");

  const data = snap.data() ?? {};
  const participantIds = Array.isArray(data.participantIds)
    ? data.participantIds
    : [];
  if (!participantIds.includes(closedByUid)) {
    throw new Error("Access denied.");
  }

  const now = FieldValue.serverTimestamp();
  await ref.update({
    sessionStatus: "closed",
    closedAt: now,
    closedByUid,
    updatedAt: now,
  });

  const messageRef = ref.collection("messages").doc();
  await messageRef.set({
    messageId: messageRef.id,
    senderId: "system",
    senderRole: "system",
    messageKind: "system",
    text: "Chat ended",
    createdAt: now,
    seenByRecipient: false,
    readAt: null,
  });
}

export async function listAgentCcChats(
  agentUid: string,
  limit = 50,
): Promise<{ assigned: CcDirectChat[]; queue: CcDirectChat[] }> {
  const fetchCap = Math.min(Math.max(limit * 5, limit), 200);

  const [assignedSnap, queueSnap] = await Promise.all([
    adminDb
      .collection(CC_DIRECT_CHATS_COLLECTION)
      .where("agentUid", "==", agentUid)
      .limit(fetchCap)
      .get(),
    adminDb
      .collection(CC_DIRECT_CHATS_COLLECTION)
      .where("queueStatus", "==", "pending")
      .limit(fetchCap)
      .get(),
  ]);

  return {
    assigned: sortByUpdatedAtDesc(
      assignedSnap.docs
        .map(mapCcChatDoc)
        .filter((room) => room.sessionStatus === "open"),
    ).slice(0, limit),
    queue: sortByUpdatedAtDesc(
      queueSnap.docs
        .map(mapCcChatDoc)
        .filter((room) => room.sessionStatus === "open"),
    ).slice(0, limit),
  };
}

export async function listWorkshopOwnersForAgent(): Promise<
  Array<{ uid: string; fullName: string; email: string; businessId: string | null }>
> {
  const snapshot = await adminDb
    .collection("users")
    .where("role", "==", "owner")
    .limit(200)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      fullName: typeof data.fullName === "string" ? data.fullName : "",
      email: typeof data.email === "string" ? data.email : "",
      businessId:
        typeof data.businessId === "string" ? data.businessId : null,
    };
  });
}

export async function startChatWithOwner(
  agentUid: string,
  workshopOwnerUid: string,
  text?: string | null,
): Promise<CcDirectChat> {
  const room = await createCcRoom(workshopOwnerUid, { agentUid });
  if (text?.trim()) {
    await appendCcDirectMessage(room.chatId, agentUid, "call_center", text);
  }
  const snap = await adminDb
    .collection(CC_DIRECT_CHATS_COLLECTION)
    .doc(room.chatId)
    .get();
  return mapCcChatDoc(snap);
}

export async function claimCcQueueChat(
  agentUid: string,
  chatId: string,
): Promise<CcDirectChat> {
  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chat not found.");

  const data = snap.data() ?? {};
  if (data.queueStatus !== "pending" || data.sessionStatus !== "open") {
    throw new Error("Chat is not available to claim.");
  }

  const agent = await getCallCenterAgentProfile(agentUid);
  const agentName = agent.fullName || agent.email || "Agent";
  const tenantUid =
    typeof data.tenantUserUid === "string" ? data.tenantUserUid : "";
  const now = FieldValue.serverTimestamp();

  await ref.update({
    agentUid,
    agentName,
    queueStatus: "active",
    participantIds: [tenantUid, agentUid],
    updatedAt: now,
  });

  const messageRef = ref.collection("messages").doc();
  await messageRef.set({
    messageId: messageRef.id,
    senderId: "system",
    senderRole: "system",
    messageKind: "system",
    text: `You are connected with ${agentName}`,
    createdAt: now,
    seenByRecipient: false,
    readAt: null,
  });

  if (tenantUid) {
    await sendChatPush({
      targetUid: tenantUid,
      title: "Call center connected",
      body: `You are connected with ${agentName}`,
      data: { type: "cc_chat_message", chatId, event: "claimed" },
    });
  }

  const updated = await ref.get();
  return mapCcChatDoc(updated);
}

export async function markCcChatReviewed(
  agentUid: string,
  chatId: string,
  reviewed: boolean,
): Promise<void> {
  const ref = adminDb.collection(CC_DIRECT_CHATS_COLLECTION).doc(chatId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Chat not found.");
  const data = snap.data() ?? {};
  if (data.agentUid !== agentUid) throw new Error("Access denied.");

  await ref.update({
    chatsReviewed: reviewed,
    chatsReviewedAt: reviewed ? FieldValue.serverTimestamp() : null,
    chatsReviewedByUid: reviewed ? agentUid : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
