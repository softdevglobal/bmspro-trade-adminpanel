import "server-only";

import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Firestore } from "firebase-admin/firestore";

import type { AgentHandler } from "@/lib/ai/agent/agent";
import { recordAgentAction } from "@/lib/ai/agent/audit";
import { writeAgentEvent } from "@/lib/ai/agent/events";
import type { ClaimedAgentEvent } from "@/lib/ai/agent/types";
import type { WriterResult } from "@/lib/ai/agent/writer";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";
import type { MessageBody, MessageHeaders } from "@/lib/email-integration/mailbox/provider";
import type { EmailProvider, MailboxFolder, MailboxMatch, PlatformDocumentRef } from "@/lib/email-integration/types";

import { EMAIL_TRIAGE_COLLECTION } from "./collections";
import { applyCodeChecks, CLASSIFIER_TEXT_CHARS, codeFlags, type ClassifierInput } from "./classify";
import { classifierKinds } from "./kinds";
import { readTriageHeaders, type TriageHeaders } from "./headers";
import { checkSenderAuthentication, senderIdentity, type IdentityResult } from "./identity";
import { examplesAgree, memoryText } from "./memory";
import { precheck, type PrecheckResult } from "./precheck";
import { askedDay, asksMoreThanHours } from "./hours";
import { defaultActions } from "./action-list";
import { applyReplyCommand } from "./replies";
import { approvedTemplateForKind, customTemplateRef, withLearnedReply } from "./reply-learning";
import { isSafetyEmail } from "./safety";
import { matchRule, recordRuleDecision } from "./rules";
import { lookupSender, senderKey } from "./senders";
import { emailAutoEnabled, emailAutoReplyEnabled, emailTriageAvailable, emailTriageDryRun, getEmailSettings, triageCutoff } from "./settings";
import type { EmailTriageResult, EmailUrgency, ExampleHit } from "./types";

/**
 * Sorts one new email: the `email.received` handler (docs/sophie-email-learning-and-auto-reply.md
 * §14.3). In order: the stored message, the switch, the mailbox, the private list, the headers,
 * the pre-check, identity, the body, memory, the classifier, then one triage row and one audit row.
 *
 * Nothing is acted on here. Cards (step 5) and actions (step 6) read the triage row. In shadow mode
 * (AI_EMAIL_TRIAGE_DRY_RUN, on by default) the row is marked `shadow`.
 *
 * All I/O comes in through `deps`, so the order of checks is tested without Firebase or OpenAI.
 */

export { EMAIL_TRIAGE_COLLECTION };
const TRIAGE_TTL_MS = 180 * 24 * 60 * 60_000;

export type TriageConnection = { id: string; businessId: string; provider: EmailProvider; address: string; status: string };

export type TriageMailbox = {
  /** Null when the message no longer exists. Throws on provider errors. */
  getHeaders(providerMessageId: string): Promise<MessageHeaders | null>;
  getBody(providerMessageId: string, maxChars: number): Promise<MessageBody | null>;
};

export type TriageDeps = {
  db: Firestore;
  env?: Readonly<Record<string, string | undefined>>;
  loadConnection(businessId: string, connectionId: string): Promise<TriageConnection | null>;
  /** Null when the mailbox can't be read now (for example, the sign-in expired). */
  openMailbox(connection: TriageConnection): Promise<TriageMailbox | null>;
  /** Customer email -> the names on records with it (BusinessMailContext.customers). */
  customers(businessId: string): Promise<Map<string, Set<string>>>;
  /** The addresses the platform sent this thread to, when the platform started it. */
  threadRecipients(businessId: string, threadId: string): Promise<string[] | null>;
  embed(text: string): Promise<number[]>;
  /** The model behind `embed`, saved with the vector so memory never mixes models. */
  embeddingModel: string;
  nearestExamples(businessId: string, vector: number[]): Promise<ExampleHit[]>;
  classify(input: ClassifierInput): Promise<WriterResult<EmailTriageResult>>;
  /** Tells the owner about a new card, by urgency (cards.ts notifyNewCard). Best effort. */
  notify?(card: { businessId: string; triageId: string; urgency: EmailUrgency; senderName: string; subject: string }): Promise<unknown>;
};

/**
 * One row per email, keyed on the mailbox and the Message-ID header. IMAP gives a message a new id
 * when it changes folder, so the same email can arrive as a second event; this key absorbs it.
 */
export function triageId(connectionId: string, messageIdHeader: string, messageDocId: string): string {
  const header = messageIdHeader.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  const key = header ? `${connectionId}\nmid:${header}` : `${connectionId}\ndoc:${messageDocId}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

type StoredMessage = {
  connectionId: string;
  providerMessageId: string;
  threadId: string;
  folder: MailboxFolder | null;
  fromName: string | null;
  fromAddress: string;
  to: string;
  cc: string;
  subject: string;
  sentAt: number | null;
  messageIdHeader: string;
  match: MailboxMatch;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

function readStoredMessage(data: DocumentData): StoredMessage {
  const method = data.matchMethod;
  return {
    connectionId: text(data.connectionId),
    providerMessageId: text(data.providerMessageId),
    threadId: text(data.threadId),
    folder: ["inbox", "sent", "archive", "trash"].includes(data.folder) ? data.folder : null,
    fromName: typeof data.fromName === "string" ? data.fromName : null,
    fromAddress: text(data.fromAddress).toLowerCase(),
    to: text(data.to),
    cc: text(data.cc),
    subject: text(data.subject),
    sentAt: data.sentAt instanceof Timestamp ? data.sentAt.toMillis() : null,
    messageIdHeader: text(data.messageIdHeader),
    match: {
      method: method === "platform_thread" || method === "customer" || method === "thread" ? method : "none",
      customerEmails: Array.isArray(data.customerEmails) ? data.customerEmails.filter((item: unknown) => typeof item === "string") : [],
      customerName: typeof data.customerName === "string" ? data.customerName : null,
      document: (data.platformDocument as PlatformDocumentRef | null) ?? null,
    },
  };
}

/** Takes the row for this event. A retry of the same event carries on; any other event is a duplicate. */
async function claimRow(db: Firestore, ref: DocumentReference, eventId: string, now: number): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      return data?.eventId === eventId && data?.status === "processing";
    }
    tx.set(ref, {
      eventId,
      status: "processing",
      createdAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + TRIAGE_TTL_MS),
    });
    return true;
  });
}

const precheckFields = (check: PrecheckResult) => ({
  precheck: check.outcome,
  // The quote or invoice whose thread this is, for resending it (step 8b).
  platformDocument: check.document?.kind === "document" && (check.document.type === "quote" || check.document.type === "invoice") && check.document.id
    ? { type: check.document.type, id: check.document.id, code: check.document.code ?? null }
    : null,
  signals: check.signals,
  promotionSignals: check.promotionSignals,
  neverReply: check.neverReply,
  blocked: check.blocked,
});

const identityFields = (identity: IdentityResult) => ({
  identity: identity.level,
  // Someone else on the email: then no private details go into a reply (T22).
  hasOtherRecipients: identity.otherRecipients.length > 0,
  identityReasons: identity.reasons,
  authResult: identity.auth,
  customerName: identity.customerName,
});

export async function triageEmail(
  deps: TriageDeps,
  event: Pick<ClaimedAgentEvent, "id" | "businessId" | "type" | "entityId">,
  now = Date.now(),
): Promise<string> {
  const { db } = deps;
  const env = deps.env ?? process.env;

  const snap = await db.collection(EMAIL_MESSAGES_COLLECTION).doc(event.entityId).get();
  const data = snap.data();
  if (!snap.exists || !data) return "message_missing";
  if (data.businessId !== event.businessId) return "foreign_message";
  const message = readStoredMessage(data);

  // The owner may have switched sorting off (or off and on again) since the event was written.
  if (!emailTriageAvailable(env)) return "sorting_off";
  const settings = await getEmailSettings(db, event.businessId);
  const cutoff = triageCutoff(settings);
  if (cutoff === null) return "sorting_off";
  if (message.sentAt !== null && message.sentAt < cutoff) return "before_cutoff";
  if (message.folder === null) return "message_gone";

  const connection = await deps.loadConnection(event.businessId, message.connectionId);
  if (!connection || connection.status === "disconnected") return "no_mailbox";
  if (message.folder === "sent" || message.fromAddress === connection.address.trim().toLowerCase()) return "sent_by_us";

  const ref = db.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId(connection.id, message.messageIdHeader, event.entityId));
  if (!(await claimRow(db, ref, event.id, now))) return "duplicate";

  const shadow = emailTriageDryRun(env);
  // What a card and a push show. Never stored for a private sender.
  const shown = {
    sender: { name: message.fromName, address: message.fromAddress },
    subject: message.subject.slice(0, 500),
  };
  const finish = async (row: Record<string, unknown>, code: string) => {
    const result = (row.result ?? null) as EmailTriageResult | null;
    const status = row.status as string;
    const precheckOutcome = (row.precheck as string | undefined) ?? "none";
    const waiting = status === "new" && precheckOutcome !== "blocked";
    const urgency: EmailUrgency | null = waiting ? (result?.urgency ?? "routine") : null;
    await ref.set({
      businessId: event.businessId,
      connectionId: connection.id,
      messageId: event.entityId,
      threadId: message.threadId,
      eventId: event.id,
      shadow,
      sender: null,
      subject: null,
      urgency,
      memoryModel: null,
      pushedAt: null,
      precheck: "none",
      signals: [],
      promotionSignals: [],
      neverReply: false,
      blocked: null,
      identity: null,
      hasOtherRecipients: true,
      identityReasons: [],
      authResult: null,
      customerName: null,
      result: null,
      aiError: null,
      codeFlags: [],
      similarExampleIds: [],
      examplesAgree: false,
      memoryVector: null,
      ruleId: null,
      ruleVersion: null,
      ruleActions: null,
      kindActions: null,
      safety: false,
      ruleReason: null,
      replyCommand: null,
      spotCheck: false,
      decisionId: null,
      ...row,
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    await recordAgentAction(db, {
      businessId: event.businessId,
      eventId: event.id,
      eventType: event.type,
      actionKey: "sort",
      action: "sort",
      status: shadow ? "dry_run" : "done",
      // Codes only: no email content goes into the audit log (§15).
      reason: code,
    }, now);

    // The type badge on the conversation in the mailbox.
    const badge = result?.kind ?? (precheckOutcome === "private" || precheckOutcome === "system" ? precheckOutcome : null);
    if (badge) {
      await db.collection(EMAIL_MESSAGES_COLLECTION).doc(event.entityId)
        .set({ sophieKind: badge, sophieTriageId: ref.id }, { merge: true })
        .catch((error) => console.error("[ai/email] badge failed", (error as Error)?.name));
    }
    if (waiting && urgency && deps.notify) {
      await deps.notify({ businessId: event.businessId, triageId: ref.id, urgency, senderName: message.fromName || message.fromAddress, subject: message.subject })
        .catch((error) => console.error("[ai/email] card push failed", (error as Error)?.name));
    }
    return code;
  };

  // A private sender: nothing more is read. No headers, no body, no AI, no memory (T03).
  const lists = await lookupSender(db, event.businessId, message.fromAddress);
  if (lists.private) {
    return finish({ precheck: "private", neverReply: true, status: "ignored" }, "private");
  }

  const mailbox = await deps.openMailbox(connection);
  let headers: TriageHeaders | null = null;
  if (mailbox) {
    // null: the message is gone. A provider error: carry on without headers (identity fails safe).
    const raw = await mailbox.getHeaders(message.providerMessageId).catch(() => undefined);
    if (raw === null) return finish({ ...shown, status: "ignored", aiError: "message_gone" }, "message_gone");
    headers = raw ? readTriageHeaders(raw) : null;
  }

  const customers = await deps.customers(event.businessId);
  const check = precheck({
    from: message.fromAddress,
    subject: message.subject,
    folder: message.folder,
    ownAddress: connection.address,
    headers,
    senderLists: lists,
    match: message.match,
    senderIsCustomer: customers.has(message.fromAddress),
  });
  // System mail and blocked senders stop here. Blocked mail waits to be filed (step 6).
  if (check.stop) {
    return finish({ ...shown, ...precheckFields(check), status: check.outcome === "blocked" ? "new" : "ignored" }, check.outcome);
  }

  const recipients = message.match.method === "platform_thread"
    ? await deps.threadRecipients(event.businessId, message.threadId)
    : null;
  const identity = senderIdentity({
    from: message.fromAddress,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    ownAddress: connection.address,
    replyTo: headers?.replyTo ?? [],
    auth: checkSenderAuthentication({
      provider: connection.provider,
      authenticationResults: headers?.authenticationResults ?? null,
      fromAddress: message.fromAddress,
    }),
    customers,
    platformThreadRecipients: recipients,
  });
  const known = { ...shown, ...precheckFields(check), ...identityFields(identity) };

  if (!mailbox) return finish({ ...known, status: "new", aiError: "mailbox_unavailable" }, "mailbox_unavailable");
  // Provider errors here throw, so the runner tries the event again later.
  const body = await mailbox.getBody(message.providerMessageId, CLASSIFIER_TEXT_CHARS);
  if (!body) return finish({ ...known, status: "ignored", aiError: "message_gone" }, "message_gone");

  const flags = codeFlags(message.subject, body.text);
  // "STOP" or "person" in answer to one of Sophie's replies (§8.5): recorded straight away.
  const command = await applyReplyCommand(db, {
    businessId: event.businessId, connectionId: connection.id, threadId: message.threadId,
    senderKey: senderKey(event.businessId, message.fromAddress), text: body.text,
  }, now).catch(() => null);
  const vector = await deps.embed(memoryText(message.subject, body.text)).catch(() => null);
  const examples = vector ? await deps.nearestExamples(event.businessId, vector).catch(() => []) : [];
  // The owner's own types join the list (step 7b).
  const kindList = await classifierKinds(db, event.businessId);
  const answer = await deps.classify({
    sender: { name: message.fromName, address: message.fromAddress },
    subject: message.subject,
    text: body.text,
    attachments: body.attachments.filter((file) => !file.inline).map((file) => ({ name: file.name, type: file.mimeType })),
    hints: {
      knownCustomer: customers.has(message.fromAddress),
      platformThread: check.outcome === "platform_thread" ? (check.document?.type ?? null) : null,
      promotionSignals: check.promotionSignals,
      automatedSender: check.neverReply,
    },
    examples,
    kinds: kindList.options,
  });
  const checked = answer.ok ? applyCodeChecks(answer.value, flags) : null;
  // Danger now: the owner hears at once (U1), and the safety reply goes out (§10.5).
  const safety = isSafetyEmail(checked);
  const result = checked && safety ? { ...checked, urgency: "now" as const } : checked;

  // Types the owner switched off just sit in the inbox (§5.1): no card, no push. Unless something
  // in it needs the owner anyway.
  if (result && settings.kindsOff.includes(result.kind) && result.flags.length === 0 && flags.length === 0) {
    return finish({ ...known, status: "ignored", result, codeFlags: flags }, `kind_off:${result.kind}`);
  }

  // Learned rules (§5). Only an approved rule acts alone, and only when nothing says to ask.
  let ruleFields: Record<string, unknown> = { ruleId: null, ruleVersion: null, ruleActions: null };
  let status: "new" | "auto_done" = "new";
  let code = result ? `sorted:${result.kind}` : "ai_failed";
  if (result) {
    const match = await matchRule(db, {
      businessId: event.businessId,
      result,
      codeFlags: flags,
      senderAddress: message.fromAddress,
      senderIsCustomer: customers.has(message.fromAddress),
      identity: identity.level,
      examples,
    }, now).catch(() => ({ outcome: "none" as const, reason: null }));
    if (match.outcome !== "none") {
      ruleFields = { ruleId: match.rule.id, ruleVersion: match.rule.version, ruleActions: match.rule.actions };
    }
    // A rule that replies acts alone only where automatic replies are allowed (step 8 pilot).
    const repliesAllowed = match.outcome === "none" || !match.rule.actions.some((action) => action.kind === "reply" || action.kind === "resend_document") || emailAutoReplyEnabled(env);
    if (match.outcome === "auto" && repliesAllowed && !shadow && !settings.paused && emailAutoEnabled(env)) {
      // The decision and its event first: a run that dies before the row is written redoes both safely.
      const recorded = await recordRuleDecision(db, {
        businessId: event.businessId,
        triageId: ref.id,
        messageId: event.entityId,
        rule: match.rule,
        senderKey: senderKey(event.businessId, message.fromAddress),
        guessedKind: result.kind,
      }, now);
      await writeAgentEvent(db, { businessId: event.businessId, type: "email.decided", entityId: ref.id }, now);
      ruleFields = { ...ruleFields, decisionId: ref.id, spotCheck: recorded.spotCheck };
      status = "auto_done";
      code = `auto:${result.kind}`;
    } else if (match.outcome === "suggest" && match.reason) {
      ruleFields = { ...ruleFields, ruleReason: match.reason };
    }
  }

  // "Are you open on Saturday?": the day asked about, read now because the body isn't kept (§8.6).
  const hoursFields = result?.kind === "hours_question"
    ? { hoursAsk: askedDay(`${message.subject}
${body.text}`), hoursAsksMore: asksMoreThanHours(body.text) }
    : { hoursAsk: null, hoursAsksMore: false };
  // What one of the owner's own types suggests, for the card.
  const ownKindActions = result ? kindList.custom.find((kind) => kind.kind === result.kind)?.actions ?? null : null;
  // A reply the owner saved and approved for this kind of email (R2, §8.1) is suggested instead of the built-in one.
  const learned = result && !safety ? await approvedTemplateForKind(db, event.businessId, result.kind).catch(() => null) : null;
  const kindActions = learned && result
    ? withLearnedReply(ownKindActions ?? defaultActions(result.kind, {
      friendlyType: result.friendlyType, customerIntent: result.customerIntent, complaintType: result.complaintType,
      documentType: check.document?.type === "quote" || check.document?.type === "invoice" ? check.document.type : null,
    }), customTemplateRef(learned.id))
    : ownKindActions;
  const sorted = await finish({
    ...known,
    ...ruleFields,
    kindActions,
    safety,
    ...hoursFields,
    replyCommand: command,
    status,
    result,
    // An AI failure still makes a row: step 5 turns it into a manual card (T20).
    aiError: answer.ok ? null : answer.reason,
    codeFlags: flags,
    similarExampleIds: examples.map((example) => example.id),
    examplesAgree: examplesAgree(examples),
    // Kept so the owner's decision can join the memory without embedding the email again.
    memoryVector: vector ? FieldValue.vector(vector) : null,
    memoryModel: vector ? deps.embeddingModel : null,
  }, code);
  // After the row is written, so the safety reply finds it.
  if (safety && !shadow) {
    await writeAgentEvent(db, { businessId: event.businessId, type: "email.safety", entityId: ref.id }, now);
  }
  return sorted;
}

/** The `email.received` handler. `makeDeps` gets the runner's Firestore and the owner to notify. */
export function emailReceivedHandler(makeDeps: (db: Firestore, ownerUid: string) => TriageDeps): AgentHandler {
  return (context) => triageEmail(makeDeps(context.db, context.principal.ownerUid), context.event, context.now);
}
