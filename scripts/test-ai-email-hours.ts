import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { runDecisionActions } from "../lib/ai/email/actions";
import type { ActionDeps, ReplySend } from "../lib/ai/email/actions/context";
import { defaultActions, parseActions } from "../lib/ai/email/action-list";
import { askedDay, asksMoreThanHours, clockLabel, dateLabel, hoursAnswer, type HoursSetup } from "../lib/ai/email/hours";
import { isSafetyEmail, runSafetyReply, SAFETY_TEMPLATE_VERSION } from "../lib/ai/email/safety";
import { DEFAULT_STYLE } from "../lib/ai/email/style";
import { renderReply } from "../lib/ai/email/templates";
import type { EmailAction, EmailTriageResult } from "../lib/ai/email/types";
import { parseOpenDays } from "../lib/calendar/working-hours";
import { fakeFirestore, type Row } from "./fake-firestore";

/**
 * Step 8b part 1 (docs/sophie-email-learning-and-auto-reply.md §8.6, §9.1, §10.5): "are you open?"
 * replies, sending a quote or invoice again, and the safety reply.
 */

const MEL = "Australia/Melbourne";
// Wednesday 26 November 2026, Melbourne (AEDT, UTC+11).
const at = (hour: number, minute = 0, day = 26) => Date.UTC(2026, 10, day, hour - 11, minute);
const WEEKDAYS: HoursSetup = { startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5], closedDates: new Set() };
const answer = (text: string, sentAt: number, now = sentAt, setup: HoursSetup = WEEKDAYS) =>
  hoursAnswer({ ask: askedDay(text), sentAt, now, timeZone: MEL, setup });

// ---- Working out the question (§8.6) ------------------------------------------------------

test("the day they ask about, or nothing when it isn't clear", () => {
  assert.deepEqual(askedDay("Are you open today?"), { kind: "today" });
  assert.deepEqual(askedDay("Open this arvo?"), { kind: "today" });
  assert.deepEqual(askedDay("Are you open tomorrow?"), { kind: "tomorrow" });
  assert.deepEqual(askedDay("Are you open on Saturday?"), { kind: "weekday", day: 6 });
  assert.deepEqual(askedDay("Open Fri?"), { kind: "weekday", day: 5 });
  assert.equal(askedDay("Are you open?"), null, "no day: the owner decides");
  assert.equal(askedDay("Are you open today or tomorrow?"), null, "two days: unclear");
  assert.equal(askedDay("I'll sit in the sun and wait"), null, "“sun” and “sat” are just words");
  assert.equal(asksMoreThanHours("Are you open today?"), false);
  assert.equal(asksMoreThanHours("Are you open today? Can I drop my car off at 7?"), true);
});

test("labels name the weekday and date, never just “today”", () => {
  assert.equal(dateLabel("2026-11-26"), "Thursday 26 November");
  assert.equal(clockLabel("08:00"), "8 am");
  assert.equal(clockLabel("17:30"), "5:30 pm");
  assert.equal(clockLabel("12:00"), "12 pm");
  assert.deepEqual(parseOpenDays([5, 1, 3]), [1, 3, 5]);
  assert.equal(parseOpenDays([]), null);
  assert.equal(parseOpenDays([1, 9]), null);
  assert.equal(parseOpenDays("weekdays"), null);
});

test("open today: the date and the hours", () => {
  const result = answer("Are you open today?", at(10));
  assert.ok(result.ok);
  assert.deepEqual(result.answer, { template: "hours_open", dayLabel: "today, Thursday 26 November", start: "8 am", end: "5 pm", next: null, closedWhenSent: false });
});

test("a closed date or a day that isn't open gives the next open day, and never the closure's reason", () => {
  const closed = answer("Are you open today?", at(10), at(10), { ...WEEKDAYS, closedDates: new Set(["2026-11-26"]) });
  assert.ok(closed.ok);
  assert.deepEqual([closed.answer.template, closed.answer.dayLabel, closed.answer.next?.dayLabel], ["hours_closed_day", "today, Thursday 26 November", "tomorrow, Friday 27 November"]);
  const saturday = answer("Are you open on Saturday?", at(10));
  assert.ok(saturday.ok);
  assert.deepEqual([saturday.answer.template, saturday.answer.dayLabel, saturday.answer.next?.dayLabel], ["hours_closed_day", "Saturday 28 November", "Monday 30 November"]);
});

test("after closing: closed when the email came in, and the next open day", () => {
  const late = answer("Are you open today?", at(21, 10), at(21, 10));
  assert.ok(late.ok);
  assert.deepEqual([late.answer.template, late.answer.closedWhenSent, late.answer.next?.dayLabel], ["hours_after_close", true, "tomorrow, Friday 27 November"]);
  // Asked in the morning, answered the next day: that day has finished.
  const stale = answer("Are you open today?", at(10), at(9, 0, 27));
  assert.ok(stale.ok);
  assert.deepEqual([stale.answer.template, stale.answer.closedWhenSent, stale.answer.next?.dayLabel], ["hours_after_close", false, "today, Friday 27 November"]);
});

test("not set up, or unclear: no answer, so no reply", () => {
  assert.deepEqual(answer("Are you open today?", at(10), at(10), { ...WEEKDAYS, openDays: null }), { ok: false, reason: "not_set" });
  assert.deepEqual(answer("Are you open today?", at(10), at(10), { ...WEEKDAYS, startTime: null }), { ok: false, reason: "not_set" });
  assert.deepEqual(answer("Are you open?", at(10)), { ok: false, reason: "unclear" });
  const allClosed = { ...WEEKDAYS, closedDates: new Set(Array.from({ length: 20 }, (_, n) => new Date(Date.UTC(2026, 10, 26 + n)).toISOString().slice(0, 10))) };
  assert.deepEqual(answer("Are you open today?", at(10), at(10), allClosed), { ok: false, reason: "no_open_day" });
});

const FACTS = { businessName: "Northside Workshop", businessPhone: "(02) 9000 0000", ownerFirstName: "Dan", firstName: null, serviceName: null, suburb: null, originalSubject: "Open today?", firstInThread: true };

test("the hours reply is filled only from the answer", () => {
  const open = answer("Are you open today?", at(10));
  assert.ok(open.ok);
  const reply = renderReply("hours_answer", { ...FACTS, hours: open.answer }, DEFAULT_STYLE);
  assert.ok(reply.ok && reply.body.includes("Yes, we're open today, Thursday 26 November, from 8 am to 5 pm."), reply.ok ? reply.body : "");
  const late = answer("Are you open today?", at(21, 10));
  assert.ok(late.ok);
  const lateReply = renderReply("hours_answer", { ...FACTS, hours: late.answer }, DEFAULT_STYLE);
  assert.ok(lateReply.ok && lateReply.body.includes("We'd closed for the day when your email came in. We're open tomorrow, Friday 27 November, from 8 am to 5 pm."));
  const sat = answer("Are you open Saturday?", at(10));
  assert.ok(sat.ok);
  const satReply = renderReply("hours_answer", { ...FACTS, hours: sat.answer }, DEFAULT_STYLE);
  assert.ok(satReply.ok && satReply.body.includes("We're closed Saturday 28 November. We're open again Monday 30 November, from 8 am to 5 pm."));
  assert.deepEqual(renderReply("hours_answer", { ...FACTS, hours: null }, DEFAULT_STYLE), { ok: false, missing: ["hours"] });
  assert.deepEqual(defaultActions("hours_question"), [{ kind: "reply", template: "hours_answer" }, { kind: "mark_read" }]);
});

// ---- The action, with fake services ---------------------------------------------------------

const ID = "a".repeat(40);
const ENV = { AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false", AI_EMAIL_TRIAGE_ENABLED: "true", AI_EMAIL_AUTO_ENABLED: "true", AI_EMAIL_AUTO_REPLY_ENABLED: "true" };

function setup(options: { actions: EmailAction[]; triage?: Row; decision?: Row; hours?: Partial<Awaited<ReturnType<ActionDeps["businessHours"]>>>; resend?: Awaited<ReturnType<ActionDeps["resendDocument"]>>; sentAt?: number; env?: Record<string, string> }) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(ID, {
    businessId: "business-a", connectionId: "conn-a", messageId: "conn-a_m1", threadId: "t1", status: "owner_done", precheck: "none",
    identity: "none", neverReply: false, subject: "Open today?", hoursAsk: { kind: "today" }, hoursAsksMore: false, ...options.triage,
  });
  table("email_messages").set("conn-a_m1", {
    businessId: "business-a", connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", unread: true,
    fromAddress: "sam@example.com", subject: "Open today?", messageIdHeader: "<m1@example.com>", references: "",
    sentAt: Timestamp.fromMillis(options.sentAt ?? at(10)),
  });
  table("ai_email_decisions").set(ID, {
    businessId: "business-a", triageId: ID, messageId: "conn-a_m1", confirmedKind: "hours_question", actions: options.actions,
    actionsStatus: "pending", decidedBy: "owner-a", via: "app", decidedAt: Timestamp.fromMillis(at(10)), ...options.decision,
  });
  const sent: ReplySend[] = [];
  const resends: Parameters<ActionDeps["resendDocument"]>[0][] = [];
  const deps: ActionDeps = {
    db,
    env: options.env ?? ENV,
    mailbox: async () => null,
    pushOwner: async () => undefined,
    timeZone: async () => MEL,
    dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    staffSchedule: async () => null,
    staffBusy: async () => [], createReturnJob: async () => ({ ok: false, error: "n/a" }),
    complaintJobs: async () => [],
    staffCheckIns: async () => [],
    customerRecords: async () => null,
    businessHours: async () => ({ startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5], closedDates: [], ...options.hours }),
    resendDocument: async (input) => { resends.push(input); return options.resend ?? { ok: true, code: "INV-1042" }; },
    replyMailbox: async () => ({ async send(input) { sent.push(input); return { ok: true, messageIdHeader: "<sophie@business.example>" }; } }),
    ensureCustomer: async () => assert.fail("not used"),
    findCustomer: async () => null,
    createRequest: async () => assert.fail("not used"),
    cancelRequest: async () => ({ ok: true }),
  };
  const result = (kind: string) => (table("ai_email_decisions").get(ID)?.results as Record<string, { status: string; summary: string }> | undefined)?.[kind];
  return { db, table, deps, sent, resends, result, run: (now = at(10, 5)) => runDecisionActions(deps, ID, now) };
}

test("an hours reply goes out with the answer worked out when it's sent", async () => {
  const s = setup({ actions: [{ kind: "reply", template: "hours_answer" }] });
  assert.equal(await s.run(), "actions:done");
  assert.ok(s.sent[0].bodyText.includes("Yes, we're open today, Thursday 26 November, from 8 am to 5 pm."));
});

test("hours not set up: no reply, and the owner is told why", async () => {
  const s = setup({ actions: [{ kind: "reply", template: "hours_answer" }], hours: { openDays: null } });
  await s.run();
  assert.deepEqual([s.sent.length, s.result("reply")?.status], [0, "needs_details"]);
  assert.match(s.result("reply")!.summary, /open days/);
});

test("a rule never sends half an answer: more than the hours asked goes to the owner", async () => {
  const rule = { via: "rule", decidedBy: "sophie", ruleId: "r".repeat(40), ruleVersion: 1 };
  const s = setup({ actions: [{ kind: "reply", template: "hours_answer" }], triage: { hoursAsksMore: true, status: "auto_done", decisionId: ID }, decision: rule });
  s.table("ai_email_rules").set("r".repeat(40), { businessId: "business-a", status: "approved", level: "auto", version: 1 });
  await s.run();
  assert.deepEqual([s.sent.length, s.result("reply")?.status], [0, "manual"]);
});

// ---- Sending a document again (§9.1) --------------------------------------------------------

const DOCUMENT = { platformDocument: { type: "invoice", id: "inv-1", code: "INV-1042" }, identity: "verified_thread" };

test("“Can you send the invoice again?” in its own thread: suggested, then sent to the address on record", async () => {
  assert.deepEqual(defaultActions("customer_question", { customerIntent: "document_request", documentType: "invoice" }).map((action) => action.kind), ["link_thread", "resend_document", "notify_owner"]);
  assert.deepEqual(defaultActions("customer_question", { customerIntent: "document_request" }).map((action) => action.kind), ["link_thread", "notify_owner"], "only in a document's thread");
  assert.deepEqual(parseActions([{ kind: "resend_document", documentId: "someone-else" }]), [{ kind: "resend_document" }], "the document always comes from the thread");
  const s = setup({ actions: [{ kind: "resend_document" }], triage: DOCUMENT });
  assert.equal(await s.run(), "actions:done");
  assert.deepEqual(s.resends, [{ businessId: "business-a", connectionId: "conn-a", documentType: "invoice", documentId: "inv-1", requester: "sam@example.com", idempotencyKey: `sophie-resend-${ID}`, actorUid: "owner-a" }]);
  assert.match(s.result("resend_document")!.summary, /INV-1042 again to sam@example\.com/);
});

test("a document is sent again only to a verified customer in its own thread, and only to the address on record", async () => {
  const unverified = setup({ actions: [{ kind: "resend_document" }], triage: { ...DOCUMENT, identity: "verified_sender" } });
  await unverified.run();
  assert.deepEqual([unverified.resends.length, unverified.result("resend_document")?.status], [0, "manual"]);
  const noDocument = setup({ actions: [{ kind: "resend_document" }], triage: { identity: "verified_thread", platformDocument: null } });
  await noDocument.run();
  assert.deepEqual([noDocument.resends.length, noDocument.result("resend_document")?.status], [0, "manual"]);
  const mismatch = setup({ actions: [{ kind: "resend_document" }], triage: DOCUMENT, resend: { ok: false, reason: "address_mismatch" } });
  await mismatch.run();
  assert.equal(mismatch.result("resend_document")?.status, "manual");
  assert.match(mismatch.result("resend_document")!.summary, /address on the document/);
  const again = setup({ actions: [{ kind: "resend_document" }], triage: DOCUMENT, resend: { ok: false, reason: "already_queued" } });
  await again.run();
  assert.equal(again.result("resend_document")?.status, "done", "a retry after it was queued");
  const broken = setup({ actions: [{ kind: "resend_document" }], triage: DOCUMENT, resend: { ok: false, reason: "failed" } });
  await assert.rejects(broken.run(), /resend_not_queued/);
});

// ---- The safety reply (§10.5) ---------------------------------------------------------------

const RESULT: EmailTriageResult = {
  kind: "complaint", confidence: 0.9, summary: "Sparks from the switchboard.", urgency: "today",
  customerIntent: null, complaintType: "safety", friendlyType: null, jobRef: null, extracted: {}, flags: [],
};

test("safety emails: a safety complaint or the safety flag", () => {
  assert.equal(isSafetyEmail(RESULT), true);
  assert.equal(isSafetyEmail({ ...RESULT, complaintType: "quality", flags: ["safety"] }), true);
  assert.equal(isSafetyEmail({ ...RESULT, complaintType: "quality" }), false);
  assert.equal(isSafetyEmail(null), false);
});

test("the safety reply goes at once, at any hour, to anyone, but only once the owner approved it", async () => {
  const notApproved = setup({ actions: [], triage: { result: RESULT } });
  assert.equal(await runSafetyReply(notApproved.deps, ID, "owner-a", at(23)), "safety:not_approved");
  assert.equal(notApproved.sent.length, 0);
  assert.match(String((notApproved.table("ai_email_triage").get(ID)?.safetyReply as Row).summary), /approve it/);

  const approved = setup({ actions: [], triage: { result: RESULT } });
  approved.table("ai_email_settings").set("business-a", { safetyReplyVersion: SAFETY_TEMPLATE_VERSION });
  assert.equal(await runSafetyReply(approved.deps, ID, "owner-a", at(23)), "safety:sent", "11 pm, unverified sender");
  const body = approved.sent[0].bodyText;
  assert.ok(body.includes("call 000 in an emergency") && body.includes("(02) 9000 0000") && body.includes("AI assistant"), body);
  assert.ok(!/\bsafe now\b|it's safe/i.test(body), "never says it's safe");
  assert.equal(approved.sent[0].idempotencyKey, `sophie-reply-${ID}-safety_holding`);
  assert.equal(await runSafetyReply(approved.deps, ID, "owner-a", at(23)), "already_sent");
  assert.equal(approved.sent.length, 1);

  const paused = setup({ actions: [], triage: { result: RESULT } });
  paused.table("ai_email_settings").set("business-a", { safetyReplyVersion: SAFETY_TEMPLATE_VERSION, paused: true });
  assert.equal(await runSafetyReply(paused.deps, ID, "owner-a", at(23)), "safety:paused");

  const practice = setup({ actions: [], triage: { result: RESULT }, env: { ...ENV, AI_AGENT_DRY_RUN: "true" } });
  practice.table("ai_email_settings").set("business-a", { safetyReplyVersion: SAFETY_TEMPLATE_VERSION });
  assert.equal(await runSafetyReply(practice.deps, ID, "owner-a", at(23)), "safety:dry_run");
  assert.equal(practice.sent.length, 0);

  const stopped = setup({ actions: [], triage: { result: RESULT, neverReply: true } });
  stopped.table("ai_email_settings").set("business-a", { safetyReplyVersion: SAFETY_TEMPLATE_VERSION });
  assert.equal(await runSafetyReply(stopped.deps, ID, "owner-a", at(23)), "safety:not_sent", "never to an automatic sender");
});

test("the safety reply can't be picked on a card or learnt by a rule", () => {
  assert.equal(parseActions([{ kind: "reply", template: "safety_holding" }]), null);
});

// ---- The visit line and the repeating safety push (§8.6, §10.5) --------------------------------

test("an hours reply adds one line about a verified customer's visit in the next 7 days, and nothing otherwise", async () => {
  const { statusFact } = await import("../lib/ai/email/status");
  const jobAt = (date: number) => ({ id: "j1", code: "BK 1042", status: "scheduled", date });
  const records = (date: number) => ({ jobs: [jobAt(date)], inspections: [], quotes: [] });
  const sat = statusFact("booking_status", records(at(10, 0, 28)), MEL);
  assert.equal(sat?.date, "2026-11-28");
  const withVisit = (visit: string | null) => renderReply("hours_answer", { businessName: "Northside Workshop", businessPhone: null, ownerFirstName: "Dan", firstName: "Priya", serviceName: null, suburb: null, originalSubject: "Open?", firstInThread: true, hours: answerOpen(), visitLine: visit }, DEFAULT_STYLE);
  const reply = withVisit(sat?.sentence ?? null);
  assert.ok(reply.ok && reply.body.includes("Yes, we're open today, Thursday 26 November, from 8 am to 5 pm.\n\nYour booking BK 1042 is scheduled for Saturday 28 November."), reply.ok ? reply.body : "");
  const plain = withVisit(null);
  assert.ok(plain.ok && !plain.body.includes("Your booking"));
});

function answerOpen() {
  const result = hoursAnswer({ ask: { kind: "today" }, sentAt: at(10), now: at(10), timeZone: MEL, setup: WEEKDAYS });
  if (!result.ok) throw new Error("hours");
  return result.answer;
}

test("the visit line reaches the reply only for a verified customer writing alone, and only within 7 days", async () => {
  const jobs = [{ id: "j1", code: "BK 1042", status: "scheduled", date: at(10, 0, 28) }];
  const far = [{ id: "j1", code: "BK 1042", status: "scheduled", date: Date.UTC(2026, 11, 9, 0, 0) }];
  const run = async (triage: Row, customerJobs: typeof jobs) => {
    const s = setup({ actions: [{ kind: "reply", template: "hours_answer" }], triage });
    s.deps.customerRecords = async () => ({ jobs: customerJobs, inspections: [], quotes: [] });
    await s.run();
    return s.sent[0]?.bodyText ?? "";
  };
  assert.ok((await run({ identity: "verified_sender", hasOtherRecipients: false }, jobs)).includes("Your booking BK 1042 is scheduled for Saturday 28 November."));
  assert.ok(!(await run({ identity: "contact_match", hasOtherRecipients: false }, jobs)).includes("Your booking"), "not verified");
  assert.ok(!(await run({ identity: "verified_sender", hasOtherRecipients: true }, jobs)).includes("Your booking"), "someone else on the email");
  assert.ok(!(await run({ identity: "verified_sender", hasOtherRecipients: false }, far)).includes("Your booking"), "more than 7 days away");
});

test("a safety email keeps pushing every 15 minutes, up to 8 times, until the owner answers", async () => {
  const { scanSafetyAcknowledgements, SAFETY_MAX_PUSHES } = await import("../lib/ai/email/safety");
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set("safe1", { businessId: "business-a", safety: true, status: "new", pushedAt: Timestamp.fromMillis(at(9)) });
  table("ai_email_triage").set("answered", { businessId: "business-a", safety: true, status: "owner_done", pushedAt: Timestamp.fromMillis(at(9)) });
  table("ai_email_triage").set("ordinary", { businessId: "business-a", safety: false, status: "new", pushedAt: Timestamp.fromMillis(at(9)) });
  const pushes: string[] = [];
  const push = async (businessId: string, p: { data: Record<string, string> }) => { pushes.push(`${businessId}:${p.data.triageId}`); };
  assert.equal(await scanSafetyAcknowledgements(db, push, at(9, 10)), 0, "10 minutes after the first push: not yet");
  assert.equal(await scanSafetyAcknowledgements(db, push, at(9, 16)), 1);
  assert.equal(await scanSafetyAcknowledgements(db, push, at(9, 20)), 0, "not again for 15 minutes");
  for (let n = 2; n < SAFETY_MAX_PUSHES + 3; n++) await scanSafetyAcknowledgements(db, push, at(9, 16 + n * 16));
  assert.equal(pushes.length, SAFETY_MAX_PUSHES - 1, "the card's own push was the first, then 7 more");
  assert.ok(pushes.every((item) => item === "business-a:safe1"), "never for an answered or an ordinary email");
  table("ai_email_triage").set("safe1", { ...table("ai_email_triage").get("safe1")!, status: "owner_done" });
  assert.equal(await scanSafetyAcknowledgements(db, push, at(20)), 0, "answering the card is the acknowledgement");
});
