export const CONVERSATIONS_COLLECTION = "conversations";
export const CC_DIRECT_CHATS_COLLECTION = "cc_direct_chats";
export const CALL_CENTER_AGENTS_COLLECTION = "call_center_agents";

export type SupportConversationStatus = "waiting" | "connected" | "closed";
export type SupportMessageSender = "customer" | "agent" | "system";

export type SupportConversation = {
  conversationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  role: string;
  ownerUid: string | null;
  status: SupportConversationStatus;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  lastMessage: string;
  lastMessageAt: number | null;
  lastSender: SupportMessageSender | null;
  unreadForAgent: number;
  unreadForCustomer: number;
  createdAt: number | null;
  updatedAt: number | null;
  claimedAt: number | null;
  closedAt: number | null;
  closedBy: "agent" | "customer" | "system" | null;
};

export type SupportMessage = {
  messageId: string;
  sender: SupportMessageSender;
  senderId: string;
  senderName: string;
  message: string;
  timestamp: number | null;
  readByAgent: boolean;
  readByCustomer: boolean;
};

export type CcQueueStatus = "pending" | "active";
export type CcSessionStatus = "open" | "closed";
export type CcMessageKind = "user" | "system";

export type CcDirectChat = {
  chatId: string;
  workshopOwnerUid: string;
  tenantUserUid: string;
  tenantRole: string;
  tenantName: string;
  agentUid: string;
  agentName: string;
  participantIds: string[];
  queueStatus: CcQueueStatus;
  sessionStatus: CcSessionStatus;
  lastMessageText: string;
  lastMessageAt: number | null;
  lastSenderId: string;
  unreadForTenant: boolean;
  unreadForAgent: boolean;
  chatsReviewed: boolean;
  chatsReviewedAt: number | null;
  chatsReviewedByUid: string | null;
  closedAt: number | null;
  closedByUid: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CcDirectMessage = {
  messageId: string;
  senderId: string;
  senderRole: string;
  messageKind: CcMessageKind;
  text: string;
  createdAt: number | null;
  seenByRecipient: boolean;
  readAt: number | null;
};
