/**
 * Step 1 of sorting: checks that need no AI (docs/sophie-email-learning-and-auto-reply.md §4.1).
 * They run in order and the first match decides. Pure: the caller loads the sender lists, the
 * headers and the customer match.
 *
 * Two outcomes matter most:
 * - `stop`: nothing more happens. No AI request, no memory, no summary text. Private senders,
 *   auto-replies and bounces, blocked senders, and mail the business sent itself.
 * - `neverReply`: the email may still be sorted (a newsletter is a promotion, a `noreply` invoice
 *   is a supplier bill), but no rule can ever answer it. This is what stops reply loops (T04).
 */

import { parseSender } from "@/lib/email-integration/mailbox/parse";
import type { MailboxFolder, MailboxMatch, PlatformDocumentRef } from "@/lib/email-integration/types";

import type { TriageHeaders } from "./headers";

export type PrecheckOutcome =
  | "sent_by_us"
  | "private"
  | "system"
  | "blocked"
  | "platform_thread"
  | "customer"
  | "none";

/** Short codes for why mail is automatic or never answered. Stored on the triage row. */
export type PrecheckSignal =
  // Automatic replies and bounces: system mail, stop.
  | "auto_replied"
  | "auto_reply_header"
  | "precedence_auto_reply"
  | "out_of_office"
  | "bounce"
  // Sent by a machine or to a list: sorted, never answered.
  | "noreply_sender"
  | "auto_generated"
  | "bulk"
  | "mailing_list"
  | "list_unsubscribe"
  | "auto_response_suppress";

export type PromotionSignal = "gmail_promotions" | "list_unsubscribe" | "outlook_other";

/** How the owner files a blocked sender's mail. */
export type BlockedSender = { kind: "address" | "domain"; folder: string };

export type PrecheckInput = {
  from: string;
  subject: string;
  folder: MailboxFolder | null;
  ownAddress: string;
  /** From getHeaders(); null when they couldn't be read. The sender and subject checks still run. */
  headers: TriageHeaders | null;
  senderLists: { private: boolean; blocked: BlockedSender | null };
  /** classifyMessage() from the sync. Its customer match includes To and Cc. */
  match: MailboxMatch;
  /** The From address itself is on a customer record (identity.ts). */
  senderIsCustomer: boolean;
};

export type PrecheckResult = {
  outcome: PrecheckOutcome;
  stop: boolean;
  neverReply: boolean;
  signals: PrecheckSignal[];
  /** A hint for the classifier. The AI still decides the type. */
  candidateKind: "quote_reply" | "invoice_reply" | "promotion" | null;
  promotionSignals: PromotionSignal[];
  /** The quote or invoice that started this thread. */
  document: PlatformDocumentRef | null;
  /** Set for a blocked sender: where to file it. */
  blocked: BlockedSender | null;
};

const OUT_OF_OFFICE = /^\s*(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|away from (the |my )?office|on (annual )?leave|on holiday|i am (currently )?(out|away)|abwesenheit)\b/i;
const NOREPLY_LOCAL = /(^|[-_.+])(no-?reply|do-?not-?reply|donotreply)([-_.+]|$)/i;
const BOUNCE_LOCAL = /^(mailer-daemon|postmaster)$/i;

/** Every machine signal in the email, whatever the outcome turns out to be. */
export function machineSignals(input: { from: string; subject: string; headers: TriageHeaders | null }): PrecheckSignal[] {
  const signals = new Set<PrecheckSignal>();
  const local = parseSender(input.from).address.split("@")[0] ?? "";
  const h = input.headers;

  if (h?.autoSubmitted && h.autoSubmitted !== "no") {
    signals.add(h.autoSubmitted === "auto-replied" ? "auto_replied" : "auto_generated");
  }
  if (h?.autoReplyHeader) signals.add("auto_reply_header");
  if (h?.precedence === "auto_reply") signals.add("precedence_auto_reply");
  if (OUT_OF_OFFICE.test(input.subject)) signals.add("out_of_office");
  if (BOUNCE_LOCAL.test(local) || h?.nullReturnPath || h?.deliveryReport) signals.add("bounce");

  if (NOREPLY_LOCAL.test(local)) signals.add("noreply_sender");
  if (h?.precedence === "bulk" || h?.precedence === "list" || h?.precedence === "junk") signals.add("bulk");
  if (h?.listId) signals.add("mailing_list");
  if (h?.listUnsubscribe) signals.add("list_unsubscribe");
  if (h?.autoResponseSuppress) signals.add("auto_response_suppress");
  return [...signals];
}

const SYSTEM_SIGNALS = new Set<PrecheckSignal>(["auto_replied", "auto_reply_header", "precedence_auto_reply", "out_of_office", "bounce"]);

export function precheck(input: PrecheckInput): PrecheckResult {
  const sender = parseSender(input.from).address;
  const signals = machineSignals(input);
  const base: PrecheckResult = {
    outcome: "none",
    stop: false,
    neverReply: signals.length > 0,
    signals,
    candidateKind: null,
    promotionSignals: [],
    document: null,
    blocked: null,
  };
  const stopAs = (outcome: PrecheckOutcome, extra: Partial<PrecheckResult> = {}): PrecheckResult =>
    ({ ...base, ...extra, outcome, stop: true, neverReply: true });

  // 1. Sent by this business.
  if (sender === input.ownAddress.trim().toLowerCase() || input.folder === "sent") return stopAs("sent_by_us");
  // 2. Private sender: checked before anything else reads the email, even its machine signals.
  if (input.senderLists.private) return stopAs("private", { signals: [] });
  // 3. Automatic replies and bounces.
  if (signals.some((signal) => SYSTEM_SIGNALS.has(signal))) return stopAs("system");
  // 4. Blocked sender: filed as the owner chose.
  if (input.senderLists.blocked) return stopAs("blocked", { blocked: input.senderLists.blocked });

  // 5. A reply in a thread the platform started.
  const document = input.match.document ?? null;
  if (input.match.method === "platform_thread") {
    const candidateKind = document?.type === "quote" ? "quote_reply" : document?.type === "invoice" ? "invoice_reply" : null;
    return { ...base, outcome: "platform_thread", candidateKind, document };
  }

  // 7. Promotion signals, never for a saved customer's own email.
  const promotionSignals: PromotionSignal[] = [];
  if (!input.senderIsCustomer) {
    if (input.headers?.gmailCategory === "promotions") promotionSignals.push("gmail_promotions");
    if (input.headers?.listUnsubscribe) promotionSignals.push("list_unsubscribe");
    if (input.headers?.outlookFocused === false) promotionSignals.push("outlook_other");
  }
  const promotion = { promotionSignals, candidateKind: promotionSignals.length > 0 ? "promotion" as const : null };

  // 6. Known customer: linked, and the AI still decides the type.
  if (input.senderIsCustomer || input.match.method === "customer" || input.match.method === "thread") {
    return { ...base, ...promotion, outcome: "customer" };
  }
  return { ...base, ...promotion };
}
