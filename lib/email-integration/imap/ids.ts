import type { MailboxFolder } from "@/lib/email-integration/types";
import { createHash } from "node:crypto";

/**
 * Pure helpers for IMAP mailboxes: message ids, conversation ids, sync
 * cursors and page tokens. IMAP has no stable cross-folder ids or threads,
 * so these are derived from folder + UID and from the References chain.
 */

/** Folders synced, in import order. Drafts and spam are never shown. */
export const IMAP_FOLDERS: MailboxFolder[] = ["inbox", "sent", "archive", "trash"];

export type ImapMessageRef = {
  folder: MailboxFolder;
  /** UIDVALIDITY of the folder when the id was made; a change invalidates UIDs. */
  uidValidity: string;
  uid: number;
};

/** `inbox_1700000000_42` — only characters a Firestore key and URL accept. */
export function encodeMessageId(ref: ImapMessageRef): string {
  return `${ref.folder}_${ref.uidValidity}_${ref.uid}`;
}

export function decodeMessageId(id: string): ImapMessageRef | null {
  const match = /^(inbox|sent|archive|trash)_(\d{1,20})_(\d{1,10})$/.exec(id);
  if (!match) return null;
  return { folder: match[1] as MailboxFolder, uidValidity: match[2], uid: Number(match[3]) };
}

const MESSAGE_ID = /<[^<>\s]+>/g;

/**
 * The Message-ID a conversation hangs off: the first entry of References,
 * else In-Reply-To, else the message's own id. Replies from every client
 * carry the root forward, so a whole conversation shares it.
 */
export function threadRoot(input: {
  messageId: string;
  inReplyTo: string;
  references: string;
}): string | null {
  return (
    input.references.match(MESSAGE_ID)?.[0] ??
    input.inReplyTo.match(MESSAGE_ID)?.[0] ??
    input.messageId.match(MESSAGE_ID)?.[0] ??
    null
  );
}

const MAX_ROOT_LENGTH = 150;

/**
 * Conversation id. Usually the root Message-ID, base64url-encoded so it can
 * be searched for again ("r…"). Very long roots are hashed ("h…") and
 * messages without any Message-ID stand alone ("x" + message id).
 */
export function threadIdFor(root: string | null, messageId: string): string {
  if (!root) return `x${messageId}`;
  if (root.length <= MAX_ROOT_LENGTH) return `r${Buffer.from(root, "utf8").toString("base64url")}`;
  return `h${createHash("sha256").update(root).digest("hex").slice(0, 40)}`;
}

export type ParsedThreadId =
  | { kind: "root"; root: string }
  | { kind: "single"; messageId: string }
  | { kind: "hashed" };

export function parseThreadId(threadId: string): ParsedThreadId | null {
  if (threadId.startsWith("x")) return { kind: "single", messageId: threadId.slice(1) };
  if (threadId.startsWith("h")) return { kind: "hashed" };
  if (!threadId.startsWith("r")) return null;
  const root = Buffer.from(threadId.slice(1), "base64url").toString("utf8");
  return /^<[^<>\s]+>$/.test(root) ? { kind: "root", root } : null;
}

// ---- Sync cursor -----------------------------------------------------------

/** Most recent UIDs per folder re-checked each run for flag changes and deletions. */
export const RECENT_WINDOW = 150;

export type FolderCursor = {
  /** UIDVALIDITY. */
  v: string;
  /** UIDNEXT: anything at or above it is new. */
  n: number;
  /** HIGHESTMODSEQ when the server supports CONDSTORE. */
  m: string | null;
  /** The newest UIDs seen, ascending. */
  r: number[];
  /** Read / starred state of each UID in `r`, one flagState() digit per UID. */
  s: string;
};

/** One digit for the flags the mailbox shows: 1 = read, 2 = starred. */
export function flagState(flags: Set<string> | undefined): string {
  return String((flags?.has("\\Seen") ? 1 : 0) + (flags?.has("\\Flagged") ? 2 : 0));
}

/** UIDs whose read / starred state differs from the last run's window. */
export function changedFlagUids(
  previous: Pick<FolderCursor, "r" | "s">,
  now: Map<number, string>,
): number[] {
  return previous.r.filter((uid, index) => now.has(uid) && previous.s[index] !== now.get(uid));
}

export type ImapCursor = { folders: Partial<Record<MailboxFolder, FolderCursor>> };

export function serializeCursor(cursor: ImapCursor): string {
  return JSON.stringify({ imap: 1, ...cursor });
}

/** Null for anything that isn't a cursor this module wrote. */
export function parseCursor(raw: string): ImapCursor | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || (data as { imap?: unknown }).imap !== 1) return null;
  const folders = (data as { folders?: unknown }).folders;
  if (!folders || typeof folders !== "object") return null;
  const result: ImapCursor = { folders: {} };
  for (const folder of IMAP_FOLDERS) {
    const item = (folders as Record<string, unknown>)[folder] as Partial<FolderCursor> | undefined;
    if (!item) continue;
    if (typeof item.v !== "string" || typeof item.n !== "number" || !Array.isArray(item.r)) return null;
    const r = item.r.filter((uid): uid is number => Number.isInteger(uid) && uid > 0);
    result.folders[folder] = {
      v: item.v,
      n: item.n,
      m: typeof item.m === "string" ? item.m : null,
      r,
      s: typeof item.s === "string" && item.s.length === r.length ? item.s : "",
    };
  }
  return result;
}

/**
 * Compares the recent window from the last run with the UIDs the folder holds
 * now (at or above the window's lowest UID). Returns the UIDs that are gone
 * and the new window.
 */
export function diffRecentWindow(
  previous: number[],
  current: number[],
): { deleted: number[]; window: number[] } {
  const now = new Set(current);
  const deleted = previous.filter((uid) => !now.has(uid));
  const window = [...now].sort((a, b) => a - b).slice(-RECENT_WINDOW);
  return { deleted, window };
}

// ---- Search page token ------------------------------------------------------

export type SearchPageToken = {
  /** Index into IMAP_FOLDERS. */
  f: number;
  /** UIDVALIDITY the paging started under (restart the folder if it changed). */
  v: string | null;
  /** Only UIDs below this; null for the first page of a folder. */
  b: number | null;
};

export function encodePageToken(token: SearchPageToken): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

export function decodePageToken(raw: string | null): SearchPageToken {
  const start: SearchPageToken = { f: 0, v: null, b: null };
  if (!raw) return start;
  try {
    const data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SearchPageToken>;
    if (typeof data.f !== "number" || data.f < 0 || data.f >= IMAP_FOLDERS.length) return start;
    return {
      f: Math.floor(data.f),
      v: typeof data.v === "string" ? data.v : null,
      b: typeof data.b === "number" && data.b > 0 ? Math.floor(data.b) : null,
    };
  } catch {
    return start;
  }
}

/**
 * One page of UIDs, newest first: the `size` highest UIDs below `before`.
 * `next` is the bound for the following page, or null when the folder is done.
 */
export function pageOfUids(
  uids: number[],
  before: number | null,
  size: number,
): { page: number[]; next: number | null } {
  const candidates = uids
    .filter((uid) => before === null || uid < before)
    .sort((a, b) => b - a);
  const page = candidates.slice(0, size);
  return { page, next: candidates.length > size ? page[page.length - 1] : null };
}
