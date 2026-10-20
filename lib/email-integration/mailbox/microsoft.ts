import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import { htmlToText, sanitizeEmailHtml } from "@/lib/email-integration/mailbox/html";
import {
  MailboxReadError,
  type MailboxAdapter,
  type MailboxMetadata,
  type MailboxSearch,
  type MessageAttachment,
} from "@/lib/email-integration/mailbox/provider";
import { GRAPH, IMMUTABLE_IDS } from "@/lib/email-integration/providers/microsoft";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";
import type { MailboxFolder } from "@/lib/email-integration/types";

const PAGE_SIZE = 50;
const RATE_LIMIT_RETRIES = 3;
/** Re-read this much before the cursor each time, so clock skew never loses a change. */
const CHANGE_OVERLAP_MS = 2 * 60 * 1000;
const INLINE_IMAGE_LIMIT = 3 * 1024 * 1024;

const SELECT = [
  "id",
  "conversationId",
  "parentFolderId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "receivedDateTime",
  "lastModifiedDateTime",
  "isRead",
  "isDraft",
  "flag",
  "hasAttachments",
  "internetMessageId",
].join(",");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a Graph path (or a full nextLink) with retries on throttling. */
async function graphRequest(
  credentials: ProviderCredentials,
  method: "GET" | "POST" | "PATCH",
  pathOrUrl: string,
  body?: unknown,
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  // Page tokens are Graph nextLinks; never follow anything else.
  if (!url.startsWith(`${GRAPH}/`)) throw new MailboxReadError(400, "invalid_page_token");
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...IMMUTABLE_IDS,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
    });
    if (response.ok) return response;
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
    if ((response.status === 429 || response.status === 503) && attempt < RATE_LIMIT_RETRIES) {
      await sleep(Math.min(retryAfterMs ?? 1000 * 2 ** attempt, 8000));
      continue;
    }
    throw new MailboxReadError(
      response.status,
      response.status === 429
        ? "rate_limited"
        : response.status === 401
          ? "unauthorised"
          : response.status === 403
            ? "read_not_authorised"
            : response.status === 404
              ? "not_found"
              : `graph_${response.status}`,
      retryAfterMs,
    );
  }
}

async function graphJson<T>(
  credentials: ProviderCredentials,
  method: "GET" | "POST" | "PATCH",
  pathOrUrl: string,
  body?: unknown,
): Promise<T> {
  const response = await graphRequest(credentials, method, pathOrUrl, body);
  if (response.status === 202 || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---- Folders -----------------------------------------------------------------

type FolderIds = Partial<Record<"inbox" | "sentitems" | "archive" | "deleteditems" | "drafts" | "junkemail", string>>;

/** Well-known folder ids for this mailbox, cached for the life of the access token. */
const folderCache = new Map<string, Promise<FolderIds>>();

function folderIds(credentials: ProviderCredentials): Promise<FolderIds> {
  const cached = folderCache.get(credentials.accessToken);
  if (cached) return cached;
  const load = (async () => {
    const names = ["inbox", "sentitems", "archive", "deleteditems", "drafts", "junkemail"] as const;
    const ids: FolderIds = {};
    await Promise.all(
      names.map(async (name) => {
        try {
          const folder = await graphJson<{ id: string }>(credentials, "GET", `/me/mailFolders/${name}?$select=id`);
          ids[name] = folder.id;
        } catch {
          /* e.g. no Archive folder yet */
        }
      }),
    );
    return ids;
  })();
  if (folderCache.size > 50) folderCache.clear();
  folderCache.set(credentials.accessToken, load);
  return load;
}

/** Outlook folder -> mailbox view. Drafts and junk are never shown. */
export function folderFor(parentFolderId: string | undefined, isDraft: boolean, folders: FolderIds): MailboxFolder | null {
  if (isDraft || !parentFolderId) return null;
  if (parentFolderId === folders.drafts || parentFolderId === folders.junkemail) return null;
  if (parentFolderId === folders.deleteditems) return "trash";
  if (parentFolderId === folders.sentitems) return "sent";
  if (parentFolderId === folders.inbox) return "inbox";
  // Archive and any folder the owner created.
  return "archive";
}

// ---- Messages ----------------------------------------------------------------

type GraphAddress = { emailAddress?: { name?: string; address?: string } };

type GraphMessage = {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  lastModifiedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  internetMessageId?: string;
};

/** `Name <address>` (or just the address), as the store and matcher expect. */
export function formatGraphAddress(entry: GraphAddress | undefined): string {
  const address = entry?.emailAddress?.address?.trim() ?? "";
  const name = entry?.emailAddress?.name?.trim().replace(/[<>"]/g, "") ?? "";
  if (!address) return name;
  return name && name.toLowerCase() !== address.toLowerCase() ? `${name} <${address}>` : address;
}

export function toMetadata(message: GraphMessage, folders: FolderIds): MailboxMetadata {
  const date = Date.parse(message.receivedDateTime ?? "");
  return {
    id: message.id,
    threadId: message.conversationId ?? message.id,
    folder: folderFor(message.parentFolderId, message.isDraft === true, folders),
    unread: message.isRead === false,
    starred: message.flag?.flagStatus === "flagged",
    from: formatGraphAddress(message.from),
    to: (message.toRecipients ?? []).map(formatGraphAddress).filter(Boolean).join(", "),
    cc: (message.ccRecipients ?? []).map(formatGraphAddress).filter(Boolean).join(", "),
    subject: message.subject ?? "",
    messageIdHeader: message.internetMessageId ?? "",
    references: "",
    snippet: (message.bodyPreview ?? "").slice(0, 300),
    date: Number.isFinite(date) ? date : null,
    hasAttachments: message.hasAttachments === true,
  };
}

type Page = { value?: GraphMessage[]; "@odata.nextLink"?: string };

async function messagePage(credentials: ProviderCredentials, pathOrUrl: string) {
  const [page, folders] = await Promise.all([
    graphJson<Page>(credentials, "GET", pathOrUrl),
    folderIds(credentials),
  ]);
  const messages = (page.value ?? []).map((message) => toMetadata(message, folders));
  return { messages, raw: page.value ?? [], nextLink: page["@odata.nextLink"] ?? null };
}

/** KQL for Outlook search: any message with one of these addresses as a participant. */
export function outlookCustomerSearch(addresses: string[]): string {
  return addresses.map((address) => `participants:${address.replace(/["\\]/g, "")}`).join(" OR ");
}

function searchPath(search: MailboxSearch): string {
  if (search.kind === "all") {
    return `/me/messages?$select=${SELECT}&$top=${PAGE_SIZE}&$orderby=receivedDateTime desc`;
  }
  const kql =
    search.kind === "customers" ? outlookCustomerSearch(search.addresses) : search.text.replace(/["\\]/g, " ");
  return `/me/messages?$select=${SELECT}&$top=${PAGE_SIZE}&$search=${encodeURIComponent(`"${kql}"`)}`;
}

function isIsoTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value);
}

type GraphAttachment = {
  "@odata.type"?: string;
  id: string;
  name?: string;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
};

export const microsoftMailbox: MailboxAdapter = {
  async startCursor() {
    return new Date(Date.now() - CHANGE_OVERLAP_MS).toISOString();
  },

  /**
   * Bounded polling on lastModifiedDateTime: new mail, moves, read state and
   * flags all bump it. Mail deleted permanently isn't reported; it simply
   * shows as "no longer in the mailbox" when opened.
   */
  async changes(credentials, cursor, max) {
    if (!isIsoTime(cursor)) throw new MailboxReadError(400, "cursor_expired");
    const startedAt = Date.now();
    const filter = encodeURIComponent(`lastModifiedDateTime ge ${cursor}`);
    let next: string | null =
      `/me/messages?$select=${SELECT}&$top=${PAGE_SIZE}&$filter=${filter}&$orderby=lastModifiedDateTime asc`;
    const prefetched: MailboxMetadata[] = [];
    let lastSeen = cursor;
    while (next && prefetched.length < max) {
      const page = await messagePage(credentials, next);
      prefetched.push(...page.messages);
      const latest = page.raw[page.raw.length - 1]?.lastModifiedDateTime;
      if (latest && isIsoTime(latest)) lastSeen = latest;
      next = page.nextLink;
    }
    // Finished: move up to (a little before) now. Stopped early: resume from the last change seen.
    const nextCursor = next
      ? lastSeen
      : new Date(Math.max(Date.parse(cursor), startedAt - CHANGE_OVERLAP_MS)).toISOString();
    return {
      changedIds: prefetched.map((message) => message.id),
      deletedIds: [],
      cursor: nextCursor,
      prefetched,
    };
  },

  async searchPage(credentials, search, pageToken) {
    const page = await messagePage(credentials, pageToken ?? searchPath(search));
    return {
      ids: page.messages.map((message) => message.id),
      nextPageToken: page.nextLink,
      prefetched: page.messages,
    };
  },

  async threadMessageIds(credentials, threadId) {
    const filter = encodeURIComponent(`conversationId eq '${threadId.replace(/'/g, "''")}'`);
    const page = await graphJson<Page>(credentials, "GET", `/me/messages?$select=id&$top=100&$filter=${filter}`);
    return (page.value ?? []).map((message) => message.id);
  },

  async getMetadata(credentials, id) {
    try {
      const [message, folders] = await Promise.all([
        graphJson<GraphMessage>(credentials, "GET", `/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`),
        folderIds(credentials),
      ]);
      return toMetadata(message, folders);
    } catch (error) {
      if (error instanceof MailboxReadError && error.code === "not_found") return null;
      throw error;
    }
  },

  async getBody(credentials, id, maxChars) {
    let message: { body?: { contentType?: string; content?: string }; hasAttachments?: boolean };
    try {
      message = await graphJson(credentials, "GET", `/me/messages/${encodeURIComponent(id)}?$select=body,hasAttachments`);
    } catch (error) {
      if (error instanceof MailboxReadError && error.code === "not_found") return null;
      throw error;
    }
    const content = message.body?.content ?? "";
    const isHtml = message.body?.contentType?.toLowerCase() === "html";
    const clip = (value: string) =>
      value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[Message truncated]` : value;

    const attachments: MessageAttachment[] = [];
    if (message.hasAttachments || /cid:/i.test(content)) {
      const list = await graphJson<{ value?: GraphAttachment[] }>(
        credentials,
        "GET",
        `/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`,
      );
      for (const item of list.value ?? []) {
        // Links to cloud files have no bytes to download.
        if (item["@odata.type"] === "#microsoft.graph.referenceAttachment") continue;
        let contentId: string | null = null;
        // Inline images: their Content-ID is only on the full attachment.
        if (item.isInline && isHtml && /cid:/i.test(content) && (item.size ?? 0) <= INLINE_IMAGE_LIMIT) {
          const full = await graphJson<GraphAttachment>(
            credentials,
            "GET",
            `/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(item.id)}?$select=id,contentId`,
          ).catch(() => null);
          contentId = full?.contentId?.replace(/^<|>$/g, "").trim() || null;
        }
        const isItem = item["@odata.type"] === "#microsoft.graph.itemAttachment";
        attachments.push({
          name: (item.name || "attachment") + (isItem && !/\.eml$/i.test(item.name ?? "") ? ".eml" : ""),
          size: item.size ?? 0,
          mimeType: isItem ? "message/rfc822" : item.contentType || "application/octet-stream",
          attachmentId: item.id,
          contentId,
          inline: item.isInline === true,
        });
      }
    }

    return {
      text: clip(isHtml ? htmlToText(content) : content.trim()),
      html: isHtml && content.trim() && content.length <= maxChars * 5 ? sanitizeEmailHtml(content) : null,
      attachments,
    };
  },

  async getAttachment(credentials, messageId, attachmentId) {
    const response = await graphRequest(
      credentials,
      "GET",
      `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
    );
    return Buffer.from(await response.arrayBuffer());
  },

  /**
   * Outlook works per message, so a conversation action applies to each of
   * its messages. Moves keep ids stable (immutable ids).
   */
  async threadAction(credentials, _threadId, action, targets) {
    const patch = (id: string, body: unknown) =>
      graphJson(credentials, "PATCH", `/me/messages/${encodeURIComponent(id)}`, body);
    const move = (id: string, destinationId: string) =>
      graphJson(credentials, "POST", `/me/messages/${encodeURIComponent(id)}/move`, { destinationId });

    for (const target of targets) {
      switch (action) {
        case "mark_read":
          await patch(target.id, { isRead: true });
          break;
        case "mark_unread":
          await patch(target.id, { isRead: false });
          break;
        case "star":
          await patch(target.id, { flag: { flagStatus: "flagged" } });
          break;
        case "unstar":
          await patch(target.id, { flag: { flagStatus: "notFlagged" } });
          break;
        case "archive":
          if (target.folder === "inbox") await move(target.id, "archive");
          break;
        case "move_to_inbox":
          if (target.folder === "archive" || target.folder === "trash") {
            await move(target.id, target.fromSelf ? "sentitems" : "inbox");
          }
          break;
        case "trash":
          if (target.folder !== "trash") await move(target.id, "deleteditems");
          break;
        case "untrash":
          if (target.folder === "trash") await move(target.id, target.fromSelf ? "sentitems" : "inbox");
          break;
      }
    }
  },
};
