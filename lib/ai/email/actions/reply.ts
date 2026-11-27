import { Timestamp } from "firebase-admin/firestore";

import { AgentHoldError } from "@/lib/ai/agent/types";

import { checkReplyGate } from "../reply-gate";
import { isOptedOut, localDate, readReplyThread, recordReplySent, repliesToday, threadChangedSince } from "../replies";
import { senderKey } from "../senders";
import { emailAutoReplyEnabled, EMAIL_SETTINGS_COLLECTION } from "../settings";
import { mapStyle } from "../style";
import { hoursAnswer, type HoursAsk } from "../hours";
import { replyByLabel, replyByTime } from "../complaints/cases";
import { statusFact } from "../status";
import { theOpenBooking } from "./reschedule";
import { loadApprovedTemplate, parseCustomTemplateRef } from "../reply-learning";
import { isCustomTemplate, renderReply, templateTitle, type CustomTemplateRef, type ReplyFacts, type TemplateId } from "../templates";
import type { ConfirmedDetails } from "../details";
import type { ActionContext, ActionHandler, ActionOutcome } from "./context";

/**
 * The reply action (docs/sophie-email-learning-and-auto-reply.md step 8): a built-in template,
 * filled from records, through the reply gate (§8.2), into the outbox as Sophie's own automatic
 * mail. An email can't be unsent, so there's no Undo.
 */

const VERIFIED = new Set(["verified_sender", "verified_thread"]);
const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : null);

/** The facts and the rendered reply for one email, as the card preview and the action see them. */
export async function prepareReply(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message" | "decision">, template: TemplateId | CustomTemplateRef, details?: ConfirmedDetails | null, now = Date.now()) {
  const { deps, businessId, triage, message } = context;
  const connectionId = String(message?.connectionId ?? triage.connectionId ?? "");
  const threadId = String(message?.threadId ?? triage.threadId ?? "");
  const [profile, thread, settings] = await Promise.all([
    deps.businessProfile(businessId),
    connectionId && threadId ? readReplyThread(deps.db, businessId, connectionId, threadId) : Promise.resolve(null),
    deps.db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).get(),
  ]);
  const confirmed = details ?? (context.decision?.details as ConfirmedDetails | null | undefined) ?? null;
  const facts: ReplyFacts = {
    businessName: profile.name,
    businessPhone: profile.phone,
    ownerFirstName: profile.ownerFirstName,
    // A name from a record or the owner's confirmation only: never a guess from the email.
    firstName: confirmed?.fullName ?? (VERIFIED.has(String(triage.identity)) && typeof triage.customerName === "string" ? triage.customerName : null),
    serviceName: null,
    suburb: confirmed?.address?.suburb || null,
    originalSubject: String(message?.subject ?? triage.subject ?? ""),
    firstInThread: (thread?.replyCount ?? 0) === 0,
    hours: template === "hours_answer" ? await hoursFacts(context, now) : null,
    visitLine: template === "hours_answer" ? await upcomingVisitLine(context, now) : null,
    status: template === "status_answer" ? await statusFacts(context) : null,
    responseBy: template === "complaint_received" ? await complaintResponseBy(context, now) : null,
    // "Can we move our visit?": the one open booking they mean, from their own records.
    bookingCode: template === "reschedule_received" ? await openBookingCode(context) : null,
    // The owner's approved wording, read now: a template they removed since is never sent.
    customBody: isCustomTemplate(template) ? (await loadApprovedTemplate(deps.db, businessId, parseCustomTemplateRef(template) ?? ""))?.body ?? null : null,
    offerTimes: template === "complaint_return_visit_offer" ? ((context.decision?.offerTimes as string[] | undefined) ?? null) : null,
  };
  const variant = parseInt(String(context.triage.messageId ?? "").replace(/[^0-9a-f]/gi, "").slice(-6) || "0", 16) || 0;
  const rendered = renderReply(template, facts, mapStyle(settings.data()?.style), variant);
  return { rendered, thread, connectionId, threadId };
}

/**
 * One line about the customer's own visit in the next 7 days, for an hours reply (§8.6). Only for a
 * verified customer writing alone, from the one scheduled booking; never an amount.
 */
async function upcomingVisitLine(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message">, now: number): Promise<string | null> {
  const timeZone = await context.deps.timeZone(context.businessId);
  const fact = await statusFacts({ ...context, triage: { ...context.triage, result: { customerIntent: "booking_status" } } });
  if (!fact?.date) return null;
  const today = localDate(now, timeZone);
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return fact.date >= today && fact.date <= limit ? fact.sentence : null;
}

/** When the owner will have replied by: the same time the case shows, worked out from the owner's answer. */
async function complaintResponseBy(context: Pick<ActionContext, "deps" | "businessId" | "decision">, now: number) {
  const timeZone = await context.deps.timeZone(context.businessId);
  const decided = context.decision?.decidedAt;
  const from = decided instanceof Timestamp ? decided.toMillis() : now;
  return replyByLabel(replyByTime(from, timeZone), timeZone);
}

/**
 * The one record that answers "where's my booking?" (§9.1). Only for a verified customer, writing
 * alone to the business (nobody else on the email), from the address on record.
 */
async function statusFacts(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message">) {
  const { deps, businessId, triage, message } = context;
  if (!VERIFIED.has(String(triage.identity)) || triage.hasOtherRecipients !== false) return null;
  const email = typeof message?.fromAddress === "string" ? message.fromAddress.trim().toLowerCase() : "";
  const intent = (triage.result as { customerIntent?: unknown } | null)?.customerIntent;
  if (!email) return null;
  const records = await deps.customerRecords(businessId, email);
  return records ? statusFact(intent, records, await deps.timeZone(businessId)) : null;
}

/** The code of the customer's one open booking, for the reschedule acknowledgement; null when unclear. */
async function openBookingCode(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message">) {
  const found = await theOpenBooking(context);
  return found.ok ? found.job.code : null;
}

/** The answer to "are you open?", from the hours, open days and closed dates. Null when unclear (§8.6). */
async function hoursFacts(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message">, now: number) {
  const sentAt = toMillis(context.message?.sentAt) ?? toMillis(context.triage.createdAt);
  if (sentAt === null) return null;
  const timeZone = await context.deps.timeZone(context.businessId);
  const from = localDate(Math.min(sentAt, now), timeZone);
  const to = localDate(Math.max(sentAt, now) + 21 * 24 * 60 * 60_000, timeZone);
  const setup = await context.deps.businessHours(context.businessId, from, to);
  const result = hoursAnswer({
    ask: (context.triage.hoursAsk ?? null) as HoursAsk | null,
    sentAt,
    now,
    timeZone,
    setup: { ...setup, closedDates: new Set(setup.closedDates) },
  });
  return result.ok ? result.answer : null;
}

export const reply: ActionHandler = {
  async run(context) {
    if (context.action.kind !== "reply") throw new Error("Wrong action.");
    return sendTemplateReply(context, context.action.template);
  },
};

/** Renders one template from records, checks the gate, and queues it. Shared with the safety reply. */
export async function sendTemplateReply(context: Omit<ActionContext, "action">, template: TemplateId | CustomTemplateRef): Promise<ActionOutcome> {
  const { deps, businessId, message, triage, now } = context;
  if (!message) return { status: "skipped", summary: "The email is no longer in the mailbox." };

  const { rendered, thread, connectionId, threadId } = await prepareReply(context, template, undefined, now);
  if (!rendered.ok) {
    return {
      status: "needs_details",
      summary: rendered.missing.includes("customBody")
        ? "I didn't reply: that saved reply was removed or isn't approved any more. Reply yourself."
        : rendered.missing.includes("bookingCode")
        ? "I didn't reply: I couldn't tell which booking they mean, or they aren't a verified customer on their own. Reply yourself."
        : rendered.missing.includes("hours")
        ? "I didn't reply: set your open days and hours under Settings, or the day they asked about wasn't clear. Reply yourself."
        : rendered.missing.includes("status")
          ? "I didn't reply: I couldn't match one booking, request or quote to answer from, or they aren't a verified customer on their own. Reply yourself."
          : "I didn't reply: add your business name and phone under Settings, then reply yourself or answer again.",
    };
  }
  // A template must answer every question in the email; a rule never sends half an answer (§8.6).
  if (template === "hours_answer" && context.authority === "rule" && triage.hoursAsksMore === true) {
    return { status: "manual", summary: "I didn't reply: they asked more than the opening hours. Reply yourself." };
  }
  const address = typeof message.fromAddress === "string" ? message.fromAddress.trim().toLowerCase() : "";
  const timeZone = await deps.timeZone(businessId);
  const today = localDate(now, timeZone);
  const [mailbox, optedOut, changed, sentToday] = await Promise.all([
    deps.replyMailbox(businessId, connectionId),
    isOptedOut(deps.db, address ? senderKey(businessId, address) : null),
    threadChangedSince(deps.db, {
      businessId, connectionId, threadId, messageId: String(triage.messageId ?? ""),
      sentAt: toMillis(message.sentAt), ownMessageIds: thread?.sentMessageIds ?? [],
    }),
    repliesToday(deps.db, businessId, today),
  ]);
  const gate = checkReplyGate({
    now,
    authority: context.authority,
    autoReplyAllowed: emailAutoReplyEnabled(deps.env ?? process.env),
    neverReply: triage.neverReply === true,
    privateSender: triage.precheck === "private",
    optedOut,
    personRequested: thread?.personRequested === true,
    replyTo: address || null,
    threadChanged: changed,
    mailboxReady: mailbox !== null,
    lastSophieReplyAt: thread?.lastReplyAt ?? null,
    repliesToday: sentToday,
    timeZone,
    text: rendered.body,
  });
  if (gate.outcome === "skip") return { status: "skipped", summary: `I didn't reply: ${gate.reason}` };
  if (gate.outcome === "ask") return { status: "manual", summary: `I didn't reply: ${gate.reason} Reply yourself from the Emails page.` };
  if (gate.outcome === "hold") throw new AgentHoldError(gate.until, gate.reason);

  const sent = await mailbox!.send({
    // One of each template per email: the safety reply and a later answer don't collide.
    idempotencyKey: `sophie-reply-${context.triageId}-${template}`.slice(0, 100),
    to: address,
    subject: rendered.subject,
    bodyText: rendered.body,
    replyTo: {
      providerMessageId: String(message.providerMessageId ?? ""),
      threadId,
      messageIdHeader: String(message.messageIdHeader ?? ""),
      references: String(message.references ?? ""),
    },
    actorUid: context.actorUid,
  });
  // The same key with other words: a retry after this reply was already queued.
  const alreadyQueued = !sent.ok && sent.code === "idempotency_conflict";
  if (!sent.ok && !alreadyQueued) {
    if (sent.code === "needs_reconnect") return { status: "manual", summary: "I didn't reply: reconnect your mailbox, then reply yourself." };
    throw new Error("reply_not_queued");
  }
  if (sent.ok) {
    await recordReplySent(deps.db, { businessId, connectionId, threadId, messageIdHeader: sent.messageIdHeader, localDate: today }, now);
  }
  return { status: "done", summary: `Replied with “${templateTitle(template)}” to ${address}.` };
}
