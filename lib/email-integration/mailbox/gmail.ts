import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import { htmlToText, sanitizeEmailHtml } from "@/lib/email-integration/mailbox/html";
import { folderFromLabels } from "@/lib/email-integration/mailbox/parse";
import {
  MailboxReadError,
  type MailboxAdapter,
  type MailboxMetadata,
  type MailboxSearch,
  type MessageBody,
} from "@/lib/email-integration/mailbox/provider";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";

export { htmlToText, sanitizeEmailHtml };

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet<T>(
  credentials: ProviderCredentials,
  path: string,
  params: URLSearchParams | Array<[string, string]> = [],
): Promise<T> {
  return gmailRequest<T>(credentials, "GET", path, params);
}

const RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gmail limits each user's request rate. Short bursts over it are retried
 * with backoff (honouring Retry-After); only a sustained limit surfaces as
 * `rate_limited`, which the sync treats as "pause and resume later".
 */
async function gmailRequest<T>(
  credentials: ProviderCredentials,
  method: "GET" | "POST",
  path: string,
  params: URLSearchParams | Array<[string, string]> = [],
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await gmailRequestOnce<T>(credentials, method, path, params, body);
    } catch (error) {
      if (
        !(error instanceof MailboxReadError && error.code === "rate_limited") ||
        attempt >= RATE_LIMIT_RETRIES
      ) {
        throw error;
      }
      const waitMs = error.retryAfterMs ?? 1000 * 2 ** attempt + Math.random() * 500;
      await sleep(Math.min(waitMs, 8000));
    }
  }
}

async function gmailRequestOnce<T>(
  credentials: ProviderCredentials,
  method: "GET" | "POST",
  path: string,
  params: URLSearchParams | Array<[string, string]> = [],
  body?: unknown,
): Promise<T> {
  const query = new URLSearchParams(params as Array<[string, string]>).toString();
  const response = await fetch(`${API}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[] };
    };
    const reason = data.error?.errors?.[0]?.reason ?? "";
    const rateLimited =
      response.status === 429 || /RateLimitExceeded/i.test(reason);
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    throw new MailboxReadError(
      response.status,
      rateLimited
        ? "rate_limited"
        : response.status === 401
          ? "unauthorised"
          : response.status === 403
            ? "read_not_authorised"
            : response.status === 404
              ? "not_found"
              : `gmail_${response.status}`,
      Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
    );
  }
  return (await response.json()) as T;
}

export async function getProfileHistoryId(
  credentials: ProviderCredentials,
): Promise<string> {
  const profile = await gmailGet<{ historyId?: string }>(credentials, "/profile");
  if (!profile.historyId) throw new MailboxReadError(502, "no_history_id");
  return profile.historyId;
}

/** One page of a Gmail search (all time, including Trash). */
export async function searchMessagePage(
  credentials: ProviderCredentials,
  query: string,
  pageToken: string | null,
): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const params: Array<[string, string]> = [
    ["q", query],
    ["maxResults", "100"],
    ["includeSpamTrash", "true"],
  ];
  if (pageToken) params.push(["pageToken", pageToken]);
  const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
    credentials,
    "/messages",
    params,
  );
  return {
    ids: (page.messages ?? []).map((message) => message.id),
    nextPageToken: page.nextPageToken ?? null,
  };
}

/** Message ids of a whole conversation; empty when the thread is gone. */
export async function getThreadMessageIds(
  credentials: ProviderCredentials,
  threadId: string,
): Promise<string[]> {
  try {
    const thread = await gmailGet<{ messages?: { id: string }[] }>(
      credentials,
      `/threads/${encodeURIComponent(threadId)}`,
      [["format", "minimal"]],
    );
    return (thread.messages ?? []).map((message) => message.id);
  } catch (error) {
    if (error instanceof MailboxReadError && error.code === "not_found") return [];
    throw error;
  }
}

export type HistoryChanges = {
  /** Messages that were added or had labels change. */
  changedIds: string[];
  deletedIds: string[];
  historyId: string | null;
};

/** Reads history since `startHistoryId`; throws `cursor_expired` when it has expired. */
export async function listHistory(
  credentials: ProviderCredentials,
  startHistoryId: string,
  maxMessages: number,
): Promise<HistoryChanges> {
  const changed = new Set<string>();
  const deleted = new Set<string>();
  let historyId: string | null = null;
  let pageToken: string | undefined;
  do {
    const params: Array<[string, string]> = [
      ["startHistoryId", startHistoryId],
      ["historyTypes", "messageAdded"],
      ["historyTypes", "labelAdded"],
      ["historyTypes", "labelRemoved"],
      ["historyTypes", "messageDeleted"],
      ["maxResults", "100"],
    ];
    if (pageToken) params.push(["pageToken", pageToken]);
    const page = await gmailGet<{
      history?: {
        messagesAdded?: { message: { id: string } }[];
        labelsAdded?: { message: { id: string } }[];
        labelsRemoved?: { message: { id: string } }[];
        messagesDeleted?: { message: { id: string } }[];
      }[];
      nextPageToken?: string;
      historyId?: string;
    }>(credentials, "/history", params).catch((error: unknown) => {
      if (error instanceof MailboxReadError && error.code === "not_found") {
        throw new MailboxReadError(404, "cursor_expired");
      }
      throw error;
    });
    for (const record of page.history ?? []) {
      for (const item of record.messagesAdded ?? []) changed.add(item.message.id);
      for (const item of record.labelsAdded ?? []) changed.add(item.message.id);
      for (const item of record.labelsRemoved ?? []) changed.add(item.message.id);
      for (const item of record.messagesDeleted ?? []) deleted.add(item.message.id);
    }
    historyId = page.historyId ?? historyId;
    pageToken = page.nextPageToken;
  } while (pageToken && changed.size < maxMessages);
  for (const id of deleted) changed.delete(id);
  return {
    changedIds: [...changed].slice(0, maxMessages),
    deletedIds: [...deleted],
    historyId,
  };
}

type RawHeader = { name?: string; value?: string };

function headersMap(headers: RawHeader[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name && header.value) map[header.name.toLowerCase()] = header.value;
  }
  return map;
}

/** Null when the message no longer exists (deleted between listing and fetching). */
export async function getMessageMetadata(
  credentials: ProviderCredentials,
  id: string,
): Promise<MailboxMetadata | null> {
  try {
    const message = await gmailGet<{
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: RawHeader[]; mimeType?: string };
    }>(credentials, `/messages/${encodeURIComponent(id)}`, [
      ["format", "metadata"],
      ["metadataHeaders", "From"],
      ["metadataHeaders", "To"],
      ["metadataHeaders", "Cc"],
      ["metadataHeaders", "Subject"],
      ["metadataHeaders", "Date"],
      ["metadataHeaders", "Message-ID"],
      ["metadataHeaders", "References"],
    ]);
    const internal = Number(message.internalDate);
    const labels = message.labelIds ?? [];
    const headers = headersMap(message.payload?.headers);
    return {
      id: message.id,
      threadId: message.threadId,
      folder: folderFromLabels(labels),
      unread: labels.includes("UNREAD"),
      starred: labels.includes("STARRED"),
      from: headers.from ?? "",
      to: headers.to ?? "",
      cc: headers.cc ?? "",
      subject: headers.subject ?? "",
      messageIdHeader: headers["message-id"] ?? "",
      references: headers.references ?? "",
      snippet: message.snippet ?? "",
      date: Number.isFinite(internal) ? internal : null,
      // Metadata format omits parts; the attachment hint comes from the mime type.
      hasAttachments: /multipart\/(mixed|related)/i.test(message.payload?.mimeType ?? ""),
    };
  } catch (error) {
    if (error instanceof MailboxReadError && error.code === "not_found") return null;
    throw error;
  }
}

// ---- Full message ------------------------------------------------------------

type Part = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: RawHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
};

export type GmailBody = MessageBody;

function decodePart(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

export function extractBody(payload: Part | undefined, maxChars: number): GmailBody {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: GmailBody["attachments"] = [];

  function walk(part: Part | undefined) {
    if (!part) return;
    const headers = headersMap(part.headers);
    const contentId = headers["content-id"]?.replace(/^<|>$/g, "").trim() || null;
    // Files, and images embedded by Content-ID even when they have no file name.
    if (part.filename || (contentId && part.body?.attachmentId)) {
      const mimeType = part.mimeType ?? "application/octet-stream";
      attachments.push({
        name: part.filename || `${contentId ?? "image"}.${mimeType.split("/")[1] ?? "bin"}`,
        size: part.body?.size ?? 0,
        mimeType,
        attachmentId: part.body?.attachmentId ?? null,
        contentId,
        inline: /^inline/i.test(headers["content-disposition"] ?? "") || Boolean(contentId && !part.filename),
      });
    } else if (part.mimeType === "text/plain") {
      plain.push(decodePart(part.body?.data));
    } else if (part.mimeType === "text/html") {
      html.push(decodePart(part.body?.data));
    }
    for (const child of part.parts ?? []) walk(child);
  }
  walk(payload);

  const rawHtml = html.join("\n");
  const text = plain.join("\n").trim() || htmlToText(rawHtml);
  const clip = (value: string) =>
    value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[Message truncated]` : value;
  return {
    text: clip(text),
    html: rawHtml.trim() && rawHtml.length <= maxChars * 5 ? sanitizeEmailHtml(rawHtml) : null,
    attachments,
  };
}

export async function getMessageBody(
  credentials: ProviderCredentials,
  id: string,
  maxChars: number,
): Promise<GmailBody | null> {
  try {
    const message = await gmailGet<{ payload?: Part }>(
      credentials,
      `/messages/${encodeURIComponent(id)}`,
      [["format", "full"]],
    );
    return extractBody(message.payload, maxChars);
  } catch (error) {
    if (error instanceof MailboxReadError && error.code === "not_found") return null;
    throw error;
  }
}

/** Raw bytes of one attachment. */
export async function getAttachment(
  credentials: ProviderCredentials,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const data = await gmailGet<{ data?: string }>(
    credentials,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return Buffer.from(data.data ?? "", "base64url");
}

// ---- Actions (need gmail.modify) ---------------------------------------------

export async function modifyThreadLabels(
  credentials: ProviderCredentials,
  threadId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  await gmailRequest(credentials, "POST", `/threads/${encodeURIComponent(threadId)}/modify`, [], {
    addLabelIds: change.add ?? [],
    removeLabelIds: change.remove ?? [],
  });
}

export async function trashThread(credentials: ProviderCredentials, threadId: string) {
  await gmailRequest(credentials, "POST", `/threads/${encodeURIComponent(threadId)}/trash`);
}

export async function untrashThread(credentials: ProviderCredentials, threadId: string) {
  await gmailRequest(credentials, "POST", `/threads/${encodeURIComponent(threadId)}/untrash`);
}

// ---- Adapter -----------------------------------------------------------------

/** Everything except spam and drafts (Trash included), newest first. */
export const WHOLE_MAILBOX_QUERY = "-in:spam -in:drafts";

/** Gmail search for every message to, from or copied to these addresses, all time. */
export function customerSearchQuery(addresses: string[]): string {
  const terms = addresses.flatMap((address) => [
    `from:${address}`,
    `to:${address}`,
    `cc:${address}`,
    `bcc:${address}`,
  ]);
  return `{${terms.join(" ")}}`;
}

function gmailQuery(search: MailboxSearch): string {
  if (search.kind === "customers") return customerSearchQuery(search.addresses);
  if (search.kind === "all") return WHOLE_MAILBOX_QUERY;
  return search.text;
}

export const gmailMailbox: MailboxAdapter = {
  startCursor: getProfileHistoryId,

  async changes(credentials, cursor, max) {
    const result = await listHistory(credentials, cursor, max);
    return {
      changedIds: result.changedIds,
      deletedIds: result.deletedIds,
      cursor: result.historyId ?? cursor,
    };
  },

  searchPage(credentials, search, pageToken) {
    return searchMessagePage(credentials, gmailQuery(search), pageToken);
  },

  threadMessageIds: getThreadMessageIds,
  getMetadata: getMessageMetadata,
  getBody: getMessageBody,
  getAttachment,

  async threadAction(credentials, threadId, action, targets) {
    switch (action) {
      case "mark_read":
        return modifyThreadLabels(credentials, threadId, { remove: ["UNREAD"] });
      case "mark_unread":
        return modifyThreadLabels(credentials, threadId, { add: ["UNREAD"] });
      case "star":
        return modifyThreadLabels(credentials, threadId, { add: ["STARRED"] });
      case "unstar":
        return modifyThreadLabels(credentials, threadId, { remove: ["STARRED"] });
      case "archive":
        return modifyThreadLabels(credentials, threadId, { remove: ["INBOX"] });
      case "move_to_inbox":
        if (targets.some((target) => target.folder === "trash")) {
          await untrashThread(credentials, threadId);
        }
        return modifyThreadLabels(credentials, threadId, { add: ["INBOX"] });
      case "trash":
        return trashThread(credentials, threadId);
      case "untrash":
        return untrashThread(credentials, threadId);
    }
  },
};
