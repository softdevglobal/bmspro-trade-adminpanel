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
  ): Promise<{ ids: string[]; nextPageToken: string | null; prefetched?: MailboxMetadata[] }>;
  threadMessageIds(credentials: ProviderCredentials, threadId: string): Promise<string[]>;
  /** Null when the message no longer exists. */
  getMetadata(credentials: ProviderCredentials, id: string): Promise<MailboxMetadata | null>;
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
}
