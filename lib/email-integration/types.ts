export type EmailProvider = "google" | "microsoft";

export type EmailConnectionStatus = "active" | "needs_reconnect" | "disconnected";

/** Connection metadata safe to return to the browser (never credentials). */
export type EmailConnectionSummary = {
  id: string;
  provider: EmailProvider;
  address: string;
  displayName: string | null;
  capabilities: string[];
  status: EmailConnectionStatus;
  connectedAt: number | null;
  lastErrorCode: string | null;
};

export type EmailDocumentType = "quote" | "invoice";

export type EmailOutboxStatus =
  | "queued"
  | "sending"
  | "retry_wait"
  | "accepted"
  | "failed"
  | "blocked_auth"
  | "unknown"
  | "held"
  | "cancelled";

/** Frozen at queue time so later document edits cannot change the email. */
export type EmailPayloadSnapshot = {
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  attachmentName: string | null;
  attachmentBytes: number | null;
  /** Mailbox sends: every attached file (names only; bytes live in Storage). */
  attachmentNames?: string[];
  /** Mailbox replies: provider thread, threading headers and the message replied to. */
  thread?: {
    providerThreadId: string;
    inReplyTo: string;
    references: string;
    replyToProviderMessageId?: string | null;
  } | null;
};

/** One send attempt as shown in a document's email history. */
export type EmailSendHistoryItem = {
  id: string;
  kind: "document" | "test" | "message";
  documentType: EmailDocumentType | null;
  documentId: string | null;
  documentCode: string | null;
  customerName: string | null;
  status: EmailOutboxStatus;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  attachmentName: string | null;
  actorName: string | null;
  attemptCount: number;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: number | null;
  acceptedAt: number | null;
  canRetry: boolean;
};

/** Defaults for the send dialog, resolved on the server. */
export type EmailSendPreview = {
  connection: EmailConnectionSummary | null;
  documentType: EmailDocumentType;
  documentId: string;
  documentVersion: string;
  documentCode: string;
  customerName: string;
  to: string[];
  subject: string;
  bodyText: string;
  totalAud: number;
  balanceDueAud: number;
  attachmentName: string;
  documentLink: string | null;
};

// ---- Mailbox (Stage 2): synced Inbox and Sent -------------------------------

export type MailboxFolder = "inbox" | "sent" | "archive" | "trash";
/** Folders plus the Starred view, which spans folders. */
export type MailboxView = MailboxFolder | "starred";

/**
 * How a message relates to the platform: in a thread the platform started,
 * in a conversation with a customer, involving a known customer, or not
 * linked ("none"). Every message is shown; this only drives the labels.
 */
export type MailboxMatch = {
  method: "platform_thread" | "thread" | "customer" | "none";
  customerEmails: string[];
  /** Set only when the matched address(es) belong to exactly one customer name. */
  customerName: string | null;
  /** The quote/invoice (or composed email) that started the thread, if any. */
  document?: PlatformDocumentRef | null;
};

export type PlatformDocumentRef = {
  kind: "document" | "message" | "test";
  type: EmailDocumentType | null;
  id: string | null;
  code: string | null;
};

export type MailboxMessageSummary = {
  id: string;
  threadId: string;
  folder: MailboxFolder;
  fromName: string | null;
  fromAddress: string;
  /** Raw To/Cc header text, for display only. */
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  date: number | null;
  hasAttachments: boolean;
  /** Unread in Gmail itself (shared provider state, not a per-user read flag). */
  unread: boolean;
  starred: boolean;
  match: MailboxMatch;
};

export type MailboxThreadMessage = MailboxMessageSummary & {
  bodyText: string | null;
  /**
   * Sanitised HTML for the sandboxed preview frame (scripts, forms, frames and
   * event handlers removed). Null for plain-text emails.
   */
  bodyHtml: string | null;
  attachments: MailboxAttachment[];
  bodyError: string | null;
};

export type MailboxAttachment = {
  name: string;
  size: number;
  mimeType: string;
  /** Gmail attachment id, for download. Null for inline parts without one. */
  attachmentId: string | null;
  /** Content-ID of an image the HTML embeds with a cid: link. */
  contentId: string | null;
  inline: boolean;
};

/** What the platform knows about the customer in a conversation. */
export type MailboxCustomerContext = {
  email: string;
  name: string | null;
  phone: string | null;
  quotes: { id: string; code: string; status: string; amountAud: number; date: number | null }[];
  invoices: { id: string; code: string; status: string; amountAud: number; date: number | null }[];
  jobs: { id: string; code: string; status: string; date: number | null }[];
  inspections: { id: string; code: string; status: string; date: number | null }[];
};

export type MailboxAction =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "move_to_inbox"
  | "trash"
  | "untrash";

export type MailboxContact = { email: string; name: string };

export type MailboxSyncStatus = {
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  syncing: boolean;
  /** False while past mail is still being imported (runs in resumable steps). */
  historyComplete: boolean;
  imported: number;
  /** Gmail asked us to slow down; importing resumes after this time. */
  pausedUntil: number | null;
};
