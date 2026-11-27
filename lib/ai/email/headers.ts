/**
 * Reads the headers Sophie's pre-check and identity check need
 * (docs/sophie-email-learning-and-auto-reply.md §4.1 and §9.2). Pure: the mailbox adapters fetch
 * the lines with getHeaders(), and this turns them into plain facts. Deciding what the facts mean
 * (system mail, promotion, verified sender) is the job of precheck.ts and identity.ts.
 *
 * Header values come from outside the business: they are trimmed, flattened and clipped, never trusted.
 */

import { extractAddresses } from "@/lib/email-integration/mailbox/parse";
import type { MessageHeaders, RawMessageHeader } from "@/lib/email-integration/mailbox/provider";

/** The only headers the adapters fetch. Lowercase. */
export const TRIAGE_HEADER_NAMES = [
  "authentication-results",
  "reply-to",
  "list-unsubscribe",
  "list-id",
  "auto-submitted",
  "x-bms-auto-submitted",
  "precedence",
  "x-autoreply",
  "x-autorespond",
  "x-auto-response-suppress",
  "return-path",
  "content-type",
] as const;

const WANTED = new Set<string>(TRIAGE_HEADER_NAMES);
const MAX_VALUE_LENGTH = 2_000;
const MAX_LINES = 60;

const GMAIL_CATEGORIES: Record<string, TriageHeaders["gmailCategory"]> = {
  CATEGORY_PERSONAL: "primary",
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
  CATEGORY_FORUMS: "forums",
};

export type TriageHeaders = {
  /** The top Authentication-Results line: the one the business's own provider added. Lower ones can be forged (§9.2). */
  authenticationResults: string | null;
  /** Addresses in Reply-To, lowercased. Replies never go here (§9.2); a difference from From lowers trust. */
  replyTo: string[];
  listUnsubscribe: boolean;
  listId: string | null;
  /** RFC 3834 value, lowercased, e.g. "auto-replied". "no" means a person sent it. */
  autoSubmitted: string | null;
  /** Lowercased, e.g. "bulk", "list", "junk", "auto_reply". */
  precedence: string | null;
  /** X-Autoreply or X-Autorespond is present. */
  autoReplyHeader: boolean;
  /** X-Auto-Response-Suppress is present (Exchange marks its own automatic mail this way). */
  autoResponseSuppress: boolean;
  /** Return-Path is `<>`: a bounce or other delivery notice (RFC 5321). */
  nullReturnPath: boolean;
  /** Content-Type is multipart/report: a delivery or read report. */
  deliveryReport: boolean;
  gmailCategory: "primary" | "promotions" | "social" | "updates" | "forums" | null;
  /** Outlook Focused Inbox: true for Focused, false for Other, null when not Outlook. */
  outlookFocused: boolean | null;
};

const flatten = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH);

/** Keeps the wanted lines in order, with lowercase names and flattened values. */
export function pickTriageHeaders(raw: readonly { name?: unknown; value?: unknown }[] | null | undefined): RawMessageHeader[] {
  const picked: RawMessageHeader[] = [];
  for (const line of raw ?? []) {
    if (typeof line?.name !== "string" || typeof line.value !== "string") continue;
    const name = line.name.trim().toLowerCase();
    if (WANTED.has(name)) picked.push({ name, value: flatten(line.value) });
    if (picked.length >= MAX_LINES) break;
  }
  return picked;
}

/** Splits a raw header block (as IMAP returns it) into lines, joining folded continuation lines. */
export function parseHeaderBlock(block: string): RawMessageHeader[] {
  const lines: { name: string; value: string }[] = [];
  for (const line of block.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line)) {
      const last = lines[lines.length - 1];
      if (last) last.value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) lines.push({ name: line.slice(0, colon), value: line.slice(colon + 1) });
  }
  return pickTriageHeaders(lines);
}

export function readTriageHeaders(input: MessageHeaders): TriageHeaders {
  const values = (name: (typeof TRIAGE_HEADER_NAMES)[number]) =>
    input.headers.filter((line) => line.name === name).map((line) => line.value);
  const first = (name: (typeof TRIAGE_HEADER_NAMES)[number]) => values(name)[0] ?? null;
  const token = (value: string | null) => value?.split(";")[0].trim().toLowerCase() || null;
  const category = input.labels.map((label) => GMAIL_CATEGORIES[label]).find(Boolean) ?? null;
  const focus = input.inferenceClassification?.toLowerCase();

  return {
    authenticationResults: first("authentication-results"),
    replyTo: extractAddresses(...values("reply-to")),
    listUnsubscribe: values("list-unsubscribe").some((value) => value !== ""),
    listId: first("list-id"),
    autoSubmitted: token(first("auto-submitted")) ?? token(first("x-bms-auto-submitted")),
    precedence: token(first("precedence")),
    autoReplyHeader: values("x-autoreply").length > 0 || values("x-autorespond").length > 0,
    autoResponseSuppress: values("x-auto-response-suppress").length > 0,
    nullReturnPath: values("return-path").some((value) => value.replace(/\s/g, "") === "<>"),
    deliveryReport: /^multipart\/report\b/i.test(first("content-type") ?? ""),
    gmailCategory: category,
    outlookFocused: focus === "focused" ? true : focus === "other" ? false : null,
  };
}
