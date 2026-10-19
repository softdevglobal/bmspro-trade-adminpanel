import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailReadError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code);
  }
}

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
        !(error instanceof GmailReadError && error.code === "rate_limited") ||
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
    throw new GmailReadError(
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
  if (!profile.historyId) throw new GmailReadError(502, "no_history_id");
  return profile.historyId;
}

export async function listMessageIds(
  credentials: ProviderCredentials,
  input: { labelId: "INBOX" | "SENT"; days: number; max: number },
): Promise<{ id: string; threadId: string }[]> {
  const found: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params: Array<[string, string]> = [
      ["labelIds", input.labelId],
      ["q", `newer_than:${input.days}d`],
      ["maxResults", String(Math.min(100, input.max - found.length))],
    ];
    if (pageToken) params.push(["pageToken", pageToken]);
    const page = await gmailGet<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    }>(credentials, "/messages", params);
    found.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && found.length < input.max);
  return found;
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
    if (error instanceof GmailReadError && error.code === "not_found") return [];
    throw error;
  }
}

export type HistoryChanges = {
  /** Messages that were added or had labels change. */
  changedIds: string[];
  deletedIds: string[];
  historyId: string | null;
};

/** Reads history since `startHistoryId`; throws `not_found` when it has expired. */
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
    }>(credentials, "/history", params);
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

export type GmailMetadata = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: number | null;
  headers: Record<string, string>;
  hasAttachments: boolean;
};

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
): Promise<GmailMetadata | null> {
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
    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds ?? [],
      snippet: message.snippet ?? "",
      internalDate: Number.isFinite(internal) ? internal : null,
      headers: headersMap(message.payload?.headers),
      // Metadata format omits parts; the attachment hint comes from the mime type.
      hasAttachments: /multipart\/(mixed|related)/i.test(message.payload?.mimeType ?? ""),
    };
  } catch (error) {
    if (error instanceof GmailReadError && error.code === "not_found") return null;
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

export type GmailBody = {
  text: string;
  html: string | null;
  attachments: {
    name: string;
    size: number;
    mimeType: string;
    attachmentId: string | null;
    /** Content-ID, for images the HTML shows inline via cid: links. */
    contentId: string | null;
    inline: boolean;
  }[];
};

function decodePart(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Reduces HTML to readable plain text (search, quoting, plain-text view). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#")) {
        const code = entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Server-side clean-up of email HTML before it reaches the preview frame.
 * Defence in depth: the frame itself is sandboxed (no scripts) and has a CSP
 * that blocks every network request unless the user chooses to show images.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|iframe|object|embed|applet|form|noscript|template|frameset|svg|math)\b[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(
      /<\/?(script|iframe|object|embed|applet|form|input|button|textarea|select|option|link|meta|base|frame|frameset|svg|math)\b[^>]*>/gi,
      "",
    )
    .replace(/\s(on[a-z]+|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src|background|action|poster|xlink:href)\s*=\s*("|')?\s*(javascript|vbscript|data:(?!image\/(png|gif|jpe?g|webp)))[^"'\s>]*("|')?/gi,
      ' $1="#"',
    );
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
    if (error instanceof GmailReadError && error.code === "not_found") return null;
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

/** Gmail's own search, used to find matches among the messages already shown. */
export async function searchMessageIds(
  credentials: ProviderCredentials,
  query: string,
  max: number,
): Promise<string[]> {
  const page = await gmailGet<{ messages?: { id: string }[] }>(credentials, "/messages", [
    ["q", query],
    ["maxResults", String(max)],
    ["includeSpamTrash", "true"],
  ]);
  return (page.messages ?? []).map((message) => message.id);
}
