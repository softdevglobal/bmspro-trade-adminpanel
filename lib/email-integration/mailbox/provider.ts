import type { ProviderCredentials } from "@/lib/email-integration/providers/types";
import type { MailboxAction, MailboxFolder } from "@/lib/email-integration/types";

/**
 * A message's details in provider-neutral form. Each provider maps its own
 * model (Gmail labels, Outlook folders and flags) onto this before storing.
 */
export type MailboxMetadata = {
  id: string;
  threadId: string;
  /** Null for mail that is never shown (drafts, spam / junk). */
  folder: MailboxFolder | null;
  unread: boolean;
  starred: boolean;
  /** Raw header-style text, e.g. `Sam <sam@example.com>, bob@example.com`. */
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** RFC 5322 Message-ID and References, for threading replies. */
  messageIdHeader: string;
  references: string;
  snippet: string;
  date: number | null;
  hasAttachments: boolean;
};

export type MessageAttachment = {
  name: string;
  size: number;
  mimeType: string;
  attachmentId: string | null;
  /** Content-ID, for images the HTML shows inline via cid: links. */
  contentId: string | null;
  inline: boolean;
};

export type MessageBody = {
  text: string;
  /** Sanitised HTML, or null for plain-text mail. */
  html: string | null;
  attachments: MessageAttachment[];
};

/** One header line as the message carries it. Names are lowercased. */
export type RawMessageHeader = { name: string; value: string };

/**
 * The headers and provider labels Sophie's triage reads for one new message
 * (docs/sophie-email-learning-and-auto-reply.md §4.1, §9.2). Read on demand,
 * never stored by the sync, so the sync schema stays as it is.
 */
export type MessageHeaders = {
  /** Only the names in TRIAGE_HEADER_NAMES, in message order: the top (newest) line first. */
  headers: RawMessageHeader[];
  /** Gmail label ids, e.g. CATEGORY_PROMOTIONS. Empty for other providers. */
  labels: string[];
  /** Outlook's Focused Inbox verdict ("focused" or "other"). Null for other providers. */
  inferenceClassification: string | null;
};

/** What to look for when importing or searching. */
export type MailboxSearch =
  | { kind: "customers"; addresses: string[] }
  | { kind: "all" }
  | { kind: "text"; text: string };

/** A stored message an action applies to, with what we know about it. */
export type ActionTarget = { id: string; folder: MailboxFolder; fromSelf: boolean };

export class MailboxReadError extends Error {
  constructor(
    public readonly status: number,
    /**
     * Stable codes the sync understands: rate_limited, unauthorised,
     * read_not_authorised, not_found, cursor_expired, or provider-specific.
     */
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code);
  }
}

/**
 * Read and organise one provider's mailbox. Sending lives in the provider's
 * EmailSendAdapter; this is everything the in-platform mailbox needs.
 */
export interface MailboxAdapter {
  /** A cursor for "changes from now on", taken before an import starts. */
  startCursor(credentials: ProviderCredentials): Promise<string>;
  /**
   * Messages changed since `cursor`. Throws MailboxReadError("cursor_expired")
   * when the cursor is too old, so the sync re-imports instead.
   */
  changes(
    credentials: ProviderCredentials,
    cursor: string,
    max: number,
  ): Promise<{ changedIds: string[]; deletedIds: string[]; cursor: string; prefetched?: MailboxMetadata[] }>;
  /** One page of results; `prefetched` saves a fetch per message where the API allows. */
  searchPage(
    credentials: ProviderCredentials,
    search: MailboxSearch,
    pageToken: string | null,
    pageSize?: number,
  ): Promise<{ ids: string[]; nextPageToken: string | null; prefetched?: MailboxMetadata[] }>;
  threadMessageIds(credentials: ProviderCredentials, threadId: string): Promise<string[]>;
  /** Null when the message no longer exists. */
  getMetadata(credentials: ProviderCredentials, id: string): Promise<MailboxMetadata | null>;
  /** One provider call per message, made at triage time. Null when the message no longer exists. */
  getHeaders(credentials: ProviderCredentials, id: string): Promise<MessageHeaders | null>;
  getBody(credentials: ProviderCredentials, id: string, maxChars: number): Promise<MessageBody | null>;
  getAttachment(credentials: ProviderCredentials, messageId: string, attachmentId: string): Promise<Buffer>;
  /**
   * Applies an action to a whole conversation (`targets` are its stored
   * messages). Providers whose ids change when mail moves folder (IMAP)
   * return the old and new id of each moved message.
   */
  threadAction(
    credentials: ProviderCredentials,
    threadId: string,
    action: MailboxAction,
    targets: ActionTarget[],
  ): Promise<void | { moved: { from: string; to: string }[] }>;
  /**
   * Moves messages out of the Inbox into the named folder (a label in Gmail), creating it when
   * missing (Sophie's folder action). Gmail and Outlook keep the ids. IMAP copies get new ids in a
   * folder the sync doesn't follow, so they simply leave the platform's views.
   */
  moveToFolder(credentials: ProviderCredentials, messageIds: string[], folderName: string): Promise<void>;
  /** Undoes moveToFolder: back to the Inbox. IMAP finds the copies in that folder by Message-ID. */
  restoreToInbox(
    credentials: ProviderCredentials,
    targets: { id: string; messageIdHeader: string }[],
    folderName: string,
  ): Promise<void>;
}
