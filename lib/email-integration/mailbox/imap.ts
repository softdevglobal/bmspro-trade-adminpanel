import "server-only";

import {
  changedFlagUids,
  decodeMessageId,
  decodePageToken,
  diffRecentWindow,
  encodeMessageId,
  encodePageToken,
  flagState,
  IMAP_FOLDERS,
  pageOfUids,
  parseCursor,
  parseThreadId,
  RECENT_WINDOW,
  serializeCursor,
  threadIdFor,
  threadRoot,
  type FolderCursor,
  type ImapCursor,
} from "@/lib/email-integration/imap/ids";
import type { ImapServerConfig } from "@/lib/email-integration/imap/servers";
import { withImap, type ImapContext } from "@/lib/email-integration/imap/session";
import { htmlToText, sanitizeEmailHtml } from "@/lib/email-integration/mailbox/html";
import {
  MailboxReadError,
  type MailboxAdapter,
  type MailboxMetadata,
  type MailboxSearch,
  type MessageAttachment,
} from "@/lib/email-integration/mailbox/provider";
import type { MailboxFolder } from "@/lib/email-integration/types";
import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlow,
  MailboxObject,
  MessageAddressObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

const PAGE_SIZE = 50;
/** Enough of the raw message for its headers and a preview line. */
const PREVIEW_SOURCE_BYTES = 12 * 1024;
const THREAD_MAX_MESSAGES = 100;

const METADATA_QUERY: FetchQueryObject = {
  uid: true,
  flags: true,
  internalDate: true,
  envelope: true,
  bodyStructure: true,
  source: { maxLength: PREVIEW_SOURCE_BYTES },
};

function formatAddresses(list: MessageAddressObject[] | undefined): string {
  return (list ?? [])
    .filter((item) => item.address)
    .map((item) => (item.name?.trim() ? `${item.name.trim()} <${item.address}>` : item.address!))
    .join(", ");
}

/** True when any part is a file rather than the message text. */
export function structureHasAttachments(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(structureHasAttachments);
  if (node.disposition?.toLowerCase() === "attachment") return true;
  const named = Boolean(node.dispositionParameters?.filename || node.parameters?.name);
  return named && node.disposition?.toLowerCase() !== "inline";
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" ");
  return typeof value === "string" ? value : "";
}

function toMillis(value: Date | string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Maps one fetched message onto the neutral shape; null for drafts / deleted. */
export function toImapMetadata(
  folder: MailboxFolder,
  uidValidity: string,
  message: Pick<FetchMessageObject, "uid" | "flags" | "envelope" | "internalDate" | "bodyStructure">,
  parsed: Pick<ParsedMail, "messageId" | "inReplyTo" | "references" | "text" | "html"> | null,
): MailboxMetadata | null {
  const flags = message.flags ?? new Set<string>();
  if (flags.has("\\Deleted") || flags.has("\\Draft")) return null;
  const id = encodeMessageId({ folder, uidValidity, uid: message.uid });
  const envelope = message.envelope ?? {};
  const messageIdHeader = parsed?.messageId ?? envelope.messageId ?? "";
  const inReplyTo = parsed?.inReplyTo ?? envelope.inReplyTo ?? "";
  const references = headerText(parsed?.references);
  const text =
    parsed?.text?.trim() || (typeof parsed?.html === "string" ? htmlToText(parsed.html) : "");
  return {
    id,
    threadId: threadIdFor(threadRoot({ messageId: messageIdHeader, inReplyTo, references }), id),
    folder,
    unread: !flags.has("\\Seen"),
    starred: flags.has("\\Flagged"),
    from: formatAddresses(envelope.from),
    to: formatAddresses(envelope.to),
    cc: formatAddresses(envelope.cc),
    subject: envelope.subject ?? "",
    messageIdHeader,
    references,
    snippet: text.replace(/\s+/g, " ").trim().slice(0, 200),
    date: toMillis(envelope.date) ?? toMillis(message.internalDate),
    hasAttachments: structureHasAttachments(message.bodyStructure),
  };
}

async function parsePreview(source: Buffer | undefined): Promise<ParsedMail | null> {
  if (!source) return null;
  // A cut-off message still parses: headers whole, text up to the cut.
  return simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  }).catch(() => null);
}

/** Metadata for UIDs in the selected folder; `removed` are drafts / deleted. */
async function fetchMetadata(
  client: ImapFlow,
  folder: MailboxFolder,
  uidValidity: string,
  uids: number[],
): Promise<{ messages: MailboxMetadata[]; removed: string[] }> {
  const messages: MailboxMetadata[] = [];
  const removed: string[] = [];
  if (uids.length === 0) return { messages, removed };
  const rows = await client.fetchAll(uids, METADATA_QUERY, { uid: true });
  // Servers answer in UID order; keep the order asked for (pages are newest first).
  const position = new Map(uids.map((uid, index) => [uid, index]));
  rows.sort((a, b) => (position.get(a.uid) ?? 0) - (position.get(b.uid) ?? 0));
  for (const row of rows) {
    const metadata = toImapMetadata(folder, uidValidity, row, await parsePreview(row.source));
    if (metadata) messages.push(metadata);
    else removed.push(encodeMessageId({ folder, uidValidity, uid: row.uid }));
  }
  return { messages, removed };
}

function searchQuery(search: MailboxSearch): SearchObject {
  switch (search.kind) {
    case "all":
      return { deleted: false };
    case "customers":
      return {
        deleted: false,
        or: search.addresses.flatMap((address) => [{ from: address }, { to: address }, { cc: address }]),
      };
    case "text":
      return { deleted: false, text: search.text };
  }
}

async function searchUids(client: ImapFlow, query: SearchObject): Promise<number[]> {
  const result = await client.search(query, { uid: true });
  return Array.isArray(result) ? result : [];
}

/** The newest UIDs in the selected folder (by position, so no full listing). */
async function newestUids(client: ImapFlow, mailbox: MailboxObject): Promise<number[]> {
  if (mailbox.exists === 0) return [];
  const from = Math.max(1, mailbox.exists - RECENT_WINDOW + 1);
  // A sequence-number FETCH works everywhere; SEARCH by sequence set doesn't.
  const rows = await client.fetchAll(`${from}:*`, { uid: true });
  return rows.map((row) => row.uid).sort((a, b) => a - b);
}

/** Read / starred state of `uids` (flags only, so cheap). */
async function flagStates(client: ImapFlow, uids: number[]): Promise<Map<number, string>> {
  if (uids.length === 0) return new Map();
  const rows = await client.fetchAll(uids, { uid: true, flags: true }, { uid: true });
  return new Map(rows.map((row) => [row.uid, flagState(row.flags)]));
}

async function snapshotFolder(client: ImapFlow, mailbox: MailboxObject): Promise<FolderCursor> {
  const r = await newestUids(client, mailbox);
  const states = await flagStates(client, r);
  return {
    v: String(mailbox.uidValidity),
    n: mailbox.uidNext,
    m: mailbox.highestModseq !== undefined ? String(mailbox.highestModseq) : null,
    r,
    s: r.map((uid) => states.get(uid) ?? "0").join(""),
  };
}

/** Resolves a stored id to its folder path and UID, if the UID is still valid. */
async function locate(
  context: ImapContext,
  id: string,
): Promise<{ path: string; folder: MailboxFolder; uidValidity: string; uid: number } | null> {
  const ref = decodeMessageId(id);
  if (!ref) return null;
  const path = (await context.folders()).get(ref.folder);
  return path ? { path, ...ref } : null;
}

/** Downloads and parses a whole message; null when it no longer exists. */
async function loadFullMessage(context: ImapContext, id: string): Promise<ParsedMail | null> {
  const target = await locate(context, id);
  if (!target) return null;
  const source = await context.inFolder(target.path, async (mailbox) => {
    if (String(mailbox.uidValidity) !== target.uidValidity) return null;
    const row = await context.client.fetchOne(String(target.uid), { source: true }, { uid: true });
    return row ? (row.source ?? null) : null;
  });
  return source ? simpleParser(source, { skipImageLinks: true, skipTextToHtml: true }) : null;
}

/** Where an action sends a message from `folder`, or null to leave it. */
function moveDestination(
  action: "archive" | "move_to_inbox" | "trash" | "untrash",
  folder: MailboxFolder,
  fromSelf: boolean,
): MailboxFolder | null {
  const home: MailboxFolder = fromSelf ? "sent" : "inbox";
  switch (action) {
    case "archive":
      return folder === "inbox" ? "archive" : null;
    case "move_to_inbox":
      return folder === "archive" || folder === "trash" ? home : null;
    case "trash":
      return folder !== "trash" ? "trash" : null;
    case "untrash":
      return folder === "trash" ? home : null;
  }
}

const FLAG_ACTIONS = {
  mark_read: { flag: "\\Seen", add: true },
  mark_unread: { flag: "\\Seen", add: false },
  star: { flag: "\\Flagged", add: true },
  unstar: { flag: "\\Flagged", add: false },
} as const;

/** Mailbox adapter for an IMAP account (Yahoo and similar). */
export function createImapMailbox(server: ImapServerConfig): MailboxAdapter {
  return {
    async startCursor(credentials) {
      return withImap(server, credentials, async (context) => {
        const cursor: ImapCursor = { folders: {} };
        for (const [folder, path] of await context.folders()) {
          cursor.folders[folder] = await context.inFolder(
            path,
            (mailbox) => snapshotFolder(context.client, mailbox),
            { fresh: true },
          );
        }
        return serializeCursor(cursor);
      });
    },

    async changes(credentials, rawCursor, max) {
      const cursor = parseCursor(rawCursor);
      if (!cursor) throw new MailboxReadError(410, "cursor_expired");
      return withImap(server, credentials, async (context) => {
        const next: ImapCursor = { folders: {} };
        const prefetched: MailboxMetadata[] = [];
        const deletedIds: string[] = [];
        let budget = max;

        for (const folder of IMAP_FOLDERS) {
          const path = (await context.folders()).get(folder);
          if (!path) continue;
          const previous = cursor.folders[folder];
          next.folders[folder] = await context.inFolder(path, async (mailbox) => {
            const client = context.client;
            const uidValidity = String(mailbox.uidValidity);
            // A folder that appeared since the last run is tracked from now on.
            if (!previous) return snapshotFolder(client, mailbox);
            if (previous.v !== uidValidity) throw new MailboxReadError(410, "cursor_expired");

            // New mail: everything at or above the old UIDNEXT, oldest first,
            // up to the run's budget (the rest is picked up next run).
            const fresh =
              mailbox.uidNext > previous.n
                ? (await searchUids(client, { uid: `${previous.n}:*` }))
                    .filter((uid) => uid >= previous.n)
                    .sort((a, b) => a - b)
                : [];
            const taken = fresh.slice(0, Math.max(0, budget));
            const nextUid =
              taken.length === fresh.length
                ? mailbox.uidNext
                : taken.length > 0
                  ? taken[taken.length - 1] + 1
                  : previous.n;

            // What's still there from the recent window tells us what was removed.
            const low = previous.r[0];
            const present = low ? await searchUids(client, { uid: `${low}:*`, deleted: false }) : fresh;
            const { deleted, window } = diffRecentWindow(previous.r, present);
            deletedIds.push(...deleted.map((uid) => encodeMessageId({ folder, uidValidity, uid })));

            // Read / starred changes in the window, from a flags-only read.
            const states = await flagStates(client, window);
            const changedFlags = new Set(changedFlagUids(previous, states));
            // With CONDSTORE, changes to older mail are caught too.
            const modseq = mailbox.highestModseq;
            if (previous.m !== null && modseq !== undefined && BigInt(previous.m) < modseq) {
              const rows = await client.fetchAll(
                "1:*",
                { uid: true, flags: true },
                { uid: true, changedSince: BigInt(previous.m) },
              );
              for (const row of rows) if (row.uid < previous.n) changedFlags.add(row.uid);
            }

            const toFetch = [...new Set([...taken, ...changedFlags])];
            const result = await fetchMetadata(client, folder, uidValidity, toFetch);
            prefetched.push(...result.messages);
            deletedIds.push(...result.removed);
            budget -= taken.length;

            return {
              v: uidValidity,
              n: nextUid,
              m: modseq !== undefined ? String(modseq) : null,
              r: window,
              s: window.map((uid) => states.get(uid) ?? "0").join(""),
            };
          }, { fresh: true });
        }

        return {
          changedIds: prefetched.map((message) => message.id),
          deletedIds,
          cursor: serializeCursor(next),
          prefetched,
        };
      });
    },

    async searchPage(credentials, search, pageToken) {
      return withImap(server, credentials, async (context) => {
        const folders = await context.folders();
        let token = decodePageToken(pageToken);
        while (token.f < IMAP_FOLDERS.length) {
          const folder = IMAP_FOLDERS[token.f];
          const path = folders.get(folder);
          const nextFolder = { f: token.f + 1, v: null, b: null };
          if (!path) {
            token = nextFolder;
            continue;
          }
          const before = token.b;
          const savedValidity = token.v;
          const page = await context.inFolder(path, async (mailbox) => {
            const uidValidity = String(mailbox.uidValidity);
            const bound = savedValidity === uidValidity ? before : null;
            const uids = await searchUids(context.client, searchQuery(search));
            const { page: slice, next } = pageOfUids(uids, bound, PAGE_SIZE);
            const result = await fetchMetadata(context.client, folder, uidValidity, slice);
            return { uidValidity, next, messages: result.messages, count: slice.length };
          });
          if (page.count === 0) {
            token = nextFolder;
            continue;
          }
          const following =
            page.next !== null
              ? { f: token.f, v: page.uidValidity, b: page.next }
              : nextFolder.f < IMAP_FOLDERS.length
                ? nextFolder
                : null;
          return {
            ids: page.messages.map((message) => message.id),
            nextPageToken: following ? encodePageToken(following) : null,
            prefetched: page.messages,
          };
        }
        return { ids: [], nextPageToken: null };
      });
    },

    async threadMessageIds(credentials, threadId) {
      const parsed = parseThreadId(threadId);
      if (!parsed || parsed.kind === "hashed") return [];
      if (parsed.kind === "single") return decodeMessageId(parsed.messageId) ? [parsed.messageId] : [];
      return withImap(server, credentials, async (context) => {
        const ids: string[] = [];
        for (const [folder, path] of await context.folders()) {
          const found = await context.inFolder(path, async (mailbox) => {
            const uids = await searchUids(context.client, {
              deleted: false,
              or: [
                { header: { "message-id": parsed.root } },
                { header: { references: parsed.root } },
                { header: { "in-reply-to": parsed.root } },
              ],
            });
            const uidValidity = String(mailbox.uidValidity);
            return uids.map((uid) => encodeMessageId({ folder, uidValidity, uid }));
          });
          ids.push(...found);
          if (ids.length >= THREAD_MAX_MESSAGES) break;
        }
        return ids.slice(0, THREAD_MAX_MESSAGES);
      });
    },

    async getMetadata(credentials, id) {
      return withImap(server, credentials, async (context) => {
        const target = await locate(context, id);
        if (!target) return null;
        return context.inFolder(target.path, async (mailbox) => {
          if (String(mailbox.uidValidity) !== target.uidValidity) return null;
          const result = await fetchMetadata(context.client, target.folder, target.uidValidity, [target.uid]);
          return result.messages[0] ?? null;
        });
      });
    },

    async getBody(credentials, id, maxChars) {
      const parsed = await withImap(server, credentials, (context) => loadFullMessage(context, id));
      if (!parsed) return null;
      const html = typeof parsed.html === "string" ? parsed.html : "";
      const text = parsed.text?.trim() || (html ? htmlToText(html) : "");
      const clip = (value: string) =>
        value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[Message truncated]` : value;
      const attachments: MessageAttachment[] = parsed.attachments.map((item, index) => ({
        name: item.filename || (item.contentType === "message/rfc822" ? "message.eml" : "attachment"),
        size: item.size ?? item.content.length,
        mimeType: item.contentType || "application/octet-stream",
        attachmentId: String(index),
        contentId: item.cid ?? (item.contentId?.replace(/^<|>$/g, "").trim() || null),
        inline: item.contentDisposition === "inline" || item.related === true,
      }));
      return {
        text: clip(text),
        html: html.trim() && html.length <= maxChars * 5 ? sanitizeEmailHtml(html) : null,
        attachments,
      };
    },

    async getAttachment(credentials, messageId, attachmentId) {
      const parsed = await withImap(server, credentials, (context) => loadFullMessage(context, messageId));
      const index = /^\d{1,4}$/.test(attachmentId) ? Number(attachmentId) : -1;
      const attachment = parsed?.attachments[index];
      if (!attachment) throw new MailboxReadError(404, "not_found");
      return attachment.content;
    },

    async threadAction(credentials, _threadId, action, targets) {
      return withImap(server, credentials, async (context) => {
        const folders = await context.folders();
        const refs = targets
          .map((target) => ({ target, ref: decodeMessageId(target.id) }))
          .filter((item): item is { target: typeof item.target; ref: NonNullable<typeof item.ref> } =>
            Boolean(item.ref),
          );

        if (action in FLAG_ACTIONS) {
          const { flag, add } = FLAG_ACTIONS[action as keyof typeof FLAG_ACTIONS];
          for (const folder of IMAP_FOLDERS) {
            const path = folders.get(folder);
            const inFolder = refs.filter((item) => item.ref.folder === folder);
            if (!path || inFolder.length === 0) continue;
            await context.inFolder(path, async (mailbox) => {
              const uids = inFolder
                .filter((item) => item.ref.uidValidity === String(mailbox.uidValidity))
                .map((item) => item.ref.uid);
              if (uids.length === 0) return;
              if (add) await context.client.messageFlagsAdd(uids, [flag], { uid: true });
              else await context.client.messageFlagsRemove(uids, [flag], { uid: true });
            });
          }
          return;
        }

        // Moves change a message's UID, so report the new ids.
        const moved: { from: string; to: string }[] = [];
        const groups = new Map<string, { from: MailboxFolder; to: MailboxFolder; refs: typeof refs }>();
        for (const item of refs) {
          const to = moveDestination(
            action as "archive" | "move_to_inbox" | "trash" | "untrash",
            item.ref.folder,
            item.target.fromSelf,
          );
          if (!to) continue;
          const key = `${item.ref.folder}>${to}`;
          const group = groups.get(key) ?? { from: item.ref.folder, to, refs: [] };
          group.refs.push(item);
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          const fromPath = folders.get(group.from);
          const toPath = folders.get(group.to);
          if (!fromPath) continue;
          if (!toPath) throw new MailboxReadError(404, "folder_missing");
          await context.inFolder(fromPath, async (mailbox) => {
            const valid = group.refs.filter((item) => item.ref.uidValidity === String(mailbox.uidValidity));
            if (valid.length === 0) return;
            const result = await context.client.messageMove(
              valid.map((item) => item.ref.uid),
              toPath,
              { uid: true },
            );
            const destinationValidity = result && result.uidValidity !== undefined ? String(result.uidValidity) : null;
            for (const item of valid) {
              const newUid = result ? result.uidMap?.get(item.ref.uid) : undefined;
              moved.push({
                from: item.target.id,
                to:
                  newUid && destinationValidity
                    ? encodeMessageId({ folder: group.to, uidValidity: destinationValidity, uid: newUid })
                    : "",
              });
            }
          });
        }
        return { moved };
      });
    },
  };
}
