import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { runDecisionActions } from "../lib/ai/email/actions";
import type { ActionDeps, ReplySend } from "../lib/ai/email/actions/context";
import { defaultActions } from "../lib/ai/email/action-list";
import { statusFact } from "../lib/ai/email/status";
import { dismissStyleSuggestion, learnFromSentEmail, readGreeting, readSignOff, styleSuggestion, STYLE_REASK_AFTER, STYLE_SAMPLES_NEEDED } from "../lib/ai/email/style-learning";
import { DEFAULT_STYLE } from "../lib/ai/email/style";
import type { MailboxCustomerContext } from "../lib/email-integration/types";
import { fakeFirestore, type Row } from "./fake-firestore";

/**
 * Step 8b part 2 (docs/sophie-email-learning-and-auto-reply.md §9.1, §8.5): "where's my booking?"
 * answered from one record, and learning the owner's greeting and sign-off from their sent email.
 */

const MEL = "Australia/Melbourne";
const NOON = Date.UTC(2026, 10, 26, 1, 0);
const BIZ = "business-a";
const ID = "a".repeat(40);

type Records = Pick<MailboxCustomerContext, "jobs" | "inspections" | "quotes">;
const records = (overrides: Partial<Records> = {}): Records => ({ jobs: [], inspections: [], quotes: [], ...overrides });
const quote = (status: string, code = "Q-1042") => ({ id: "q1", code, status, amountAud: 842.4, date: NOON });

// ---- The one record that answers (§9.1) -----------------------------------------------------

test("a booking: its status in plain words, with the date for a scheduled one", () => {
  const scheduled = statusFact("booking_status", records({ jobs: [{ id: "j1", code: "J-1042", status: "scheduled", date: Date.UTC(2026, 10, 26, 22, 0) }] }), MEL);
  assert.equal(scheduled?.sentence, "Your booking J-1042 is scheduled for Friday 27 November.");
  assert.equal(statusFact("booking_status", records({ jobs: [{ id: "j1", code: "J-1", status: "ongoing", date: NOON }] }), MEL)?.sentence, "Your booking J-1 is under way.");
  assert.match(statusFact("booking_status", records({ jobs: [{ id: "j1", code: "J-1", status: "awaiting", date: null }] }), MEL)!.sentence, /we'll confirm a time/);
  assert.equal(statusFact("booking_status", records({ jobs: [{ id: "j1", code: "J-1", status: "scheduled", date: null }] }), MEL), null, "no date, no answer");
});

test("Sophie never guesses which record they mean", () => {
  const two = records({ jobs: [{ id: "j1", code: "J-1", status: "scheduled", date: NOON }, { id: "j2", code: "J-2", status: "scheduled", date: NOON }] });
  assert.equal(statusFact("booking_status", two, MEL), null, "two open bookings");
  assert.equal(statusFact("booking_status", records({ jobs: [{ id: "j1", code: "J-1", status: "completed", date: NOON }] }), MEL), null, "nothing open");
  assert.equal(statusFact("quote_status", records({ quotes: [quote("sent"), quote("accepted", "Q-2")] }), MEL), null);
  assert.equal(statusFact("quote_status", records({ quotes: [quote("draft")] }), MEL), null, "a draft was never sent to them");
  assert.equal(statusFact("document_request", records(), MEL), null, "other questions aren't status questions");
});

test("a request waiting for a time, and quotes by status, never with an amount", () => {
  const request = statusFact("request_status", records({ inspections: [{ id: "r1", code: "INS-7", status: "pending", date: NOON }] }), MEL);
  assert.equal(request?.sentence, "We've received your request INS-7, and we'll be in touch to confirm a time.");
  assert.equal(statusFact("request_status", records({ inspections: [{ id: "r1", code: "INS-7", status: "scheduled", date: NOON }] }), MEL), null, "once booked, the owner answers");
  assert.match(statusFact("quote_status", records({ quotes: [quote("sent")] }), MEL)!.sentence, /Q-1042 has been sent to you/);
  assert.match(statusFact("quote_status", records({ quotes: [quote("accepted")] }), MEL)!.sentence, /accepted/);
  assert.match(statusFact("quote_status", records({ quotes: [quote("declined")] }), MEL)!.sentence, /declined/);
  for (const intent of ["booking_status", "request_status", "quote_status"]) {
    const fact = statusFact(intent, records({ jobs: [{ id: "j", code: "J-1", status: "ongoing", date: NOON }], inspections: [{ id: "r", code: "R-1", status: "pending", date: NOON }], quotes: [quote("sent")] }), MEL);
    assert.ok(!fact || !/\$|842/.test(fact.sentence), "no amounts");
  }
});

test("status questions suggest a reply", () => {
  assert.deepEqual(defaultActions("customer_question", { customerIntent: "booking_status" }).map((action) => action.kind), ["link_thread", "reply", "notify_owner"]);
  assert.deepEqual(defaultActions("customer_question", { customerIntent: "booking_cancel" }).map((action) => action.kind), ["link_thread", "notify_owner"]);
});

// ---- The action -----------------------------------------------------------------------------

const ENV = { AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false", AI_EMAIL_TRIAGE_ENABLED: "true", AI_EMAIL_AUTO_ENABLED: "true", AI_EMAIL_AUTO_REPLY_ENABLED: "true" };
const OPEN_JOB = { id: "j1", code: "J-1042", status: "ongoing", date: NOON };

function setup(options: { triage?: Row; records?: Records | null } = {}) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(ID, {
    businessId: BIZ, connectionId: "conn-a", messageId: "conn-a_m1", threadId: "t1", status: "owner_done", precheck: "none",
    identity: "verified_sender", hasOtherRecipients: false, neverReply: false, subject: "Where's my tech?",
    result: { kind: "customer_question", customerIntent: "booking_status" }, ...options.triage,
  });
  table("email_messages").set("conn-a_m1", {
    businessId: BIZ, connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", fromAddress: "priya@customer.example",
    subject: "Where's my tech?", messageIdHeader: "<m1@customer.example>", references: "", sentAt: Timestamp.fromMillis(NOON - 60_000),
  });
  table("ai_email_decisions").set(ID, {
    businessId: BIZ, triageId: ID, messageId: "conn-a_m1", confirmedKind: "customer_question", actions: [{ kind: "reply", template: "status_answer" }],
    actionsStatus: "pending", decidedBy: "owner-a", via: "app", decidedAt: Timestamp.fromMillis(NOON),
  });
  const sent: ReplySend[] = [];
  const asked: string[] = [];
  const deps: ActionDeps = {
    db, env: ENV,
    mailbox: async () => null, pushOwner: async () => undefined, timeZone: async () => MEL, dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    staffSchedule: async () => null,
    staffBusy: async () => [], createReturnJob: async () => ({ ok: false, error: "n/a" }),
    complaintJobs: async () => [],
    staffCheckIns: async () => [],
    customerRecords: async (_businessId, email) => { asked.push(email); return options.records === undefined ? records({ jobs: [OPEN_JOB] }) : options.records; },
    businessHours: async () => ({ startTime: null, endTime: null, openDays: null, closedDates: [] }),
    resendDocument: async () => ({ ok: false, reason: "not_found" }),
    replyMailbox: async () => ({ async send(input) { sent.push(input); return { ok: true, messageIdHeader: "<s@b.example>" }; } }),
    ensureCustomer: async () => assert.fail("not used"), findCustomer: async () => null,
    createRequest: async () => assert.fail("not used"), cancelRequest: async () => ({ ok: true }),
  };
  const result = () => (table("ai_email_decisions").get(ID)?.results as Record<string, { status: string; summary: string }> | undefined)?.reply;
  return { table, deps, sent, asked, result, run: () => runDecisionActions(deps, ID, NOON) };
}

test("a verified customer gets the one sentence from their own record", async () => {
  const s = setup();
  assert.equal(await s.run(), "actions:done");
  assert.deepEqual(s.asked, ["priya@customer.example"]);
  assert.ok(s.sent[0].bodyText.includes("Your booking J-1042 is under way."), s.sent[0].bodyText);
  assert.ok(s.sent[0].bodyText.includes("AI assistant"));
});

test("nobody else gets their records: unverified, copied in, or no single record", async () => {
  for (const [label, triage, recs] of [
    ["not verified", { identity: "contact_match" }, undefined],
    ["someone else on the email", { hasOtherRecipients: true }, undefined],
    ["an older row without the field", { hasOtherRecipients: undefined }, undefined],
    ["not their customer", {}, null],
    ["no open booking", {}, records()],
  ] as [string, Row, Records | null | undefined][]) {
    const s = setup({ triage, records: recs });
    await s.run();
    assert.deepEqual([label, s.sent.length, s.result()?.status], [label, 0, "needs_details"]);
  }
});

// ---- Learning the owner's style (§8.5) ------------------------------------------------------

test("greetings become patterns, and the name never survives", () => {
  assert.deepEqual(readGreeting("Hi Priya,"), { greeting: "Hi {firstName}," });
  assert.deepEqual(readGreeting("G'day Sam,"), { greeting: "G'day {firstName}," });
  assert.deepEqual(readGreeting("Hi there,"), { unknown: "Hi there," });
  assert.deepEqual(readGreeting("Hello,"), { unknown: "Hello," });
  assert.equal(readGreeting("Hi Priya and Sam,"), null);
  assert.equal(readGreeting("Quote attached for the Ryde job"), null);
  assert.equal(readGreeting("Hi Priya, thanks for your email about the gate and the intercom"), null);
});

test("sign-offs come from the end of what the owner wrote, not the quoted email", () => {
  assert.equal(readSignOff("Hi Priya,\n\nSee you Thursday.\n\ncheers\nDan"), "Cheers,");
  assert.equal(readSignOff("Hi,\n\nThanks!\nDan Smith\n0412 000 000"), "Thanks,");
  assert.equal(readSignOff("Hi,\n\nOK.\n\nOn Tue, 3 Nov 2026, Priya wrote:\nKind regards\nPriya"), null, "the quoted original isn't theirs");
  assert.equal(readSignOff("See you then"), "See you then,");
  assert.equal(readSignOff("No sign off here"), null);
});

function outbox(table: ReturnType<typeof fakeFirestore>["table"], id: string, bodyText: string, extra: Row = {}) {
  table("email_outbox").set(id, { businessId: BIZ, kind: "message", intent: "reply", payloadSnapshot: { bodyText }, ...extra });
}

test("only the owner's own words are learnt, once, and only the two lines are kept", async () => {
  const { db, table } = fakeFirestore();
  outbox(table, "o1", "Hi Priya,\n\nThe gate part is $842 and Sam will fit it Tuesday.\n\nCheers\nDan");
  outbox(table, "agent", "Hi Priya,\n\nCheers", { origin: "agent" });
  outbox(table, "doc", "Hi Priya,\n\nCheers", { kind: "document" });
  outbox(table, "fwd", "Hi Priya,\n\nCheers", { intent: "forward" });
  outbox(table, "other", "Hi Priya,\n\nCheers", { businessId: "business-b" });
  assert.equal(await learnFromSentEmail(db, BIZ, "o1", NOON), "learned");
  assert.equal(await learnFromSentEmail(db, BIZ, "o1", NOON), "already_learned");
  assert.equal(await learnFromSentEmail(db, BIZ, "agent", NOON), "not_owner_words");
  assert.equal(await learnFromSentEmail(db, BIZ, "doc", NOON), "not_owner_words");
  assert.equal(await learnFromSentEmail(db, BIZ, "fwd", NOON), "not_owner_words");
  assert.equal(await learnFromSentEmail(db, BIZ, "other", NOON), "outbox_missing");
  assert.equal(await learnFromSentEmail(db, BIZ, "nope", NOON), "outbox_missing");
  const kept = table("ai_email_style_samples").get(BIZ)!;
  assert.deepEqual([kept.samples, kept.greetings, kept.signOffs], [1, [{ text: "Hi {firstName},", count: 1 }], [{ text: "Cheers,", count: 1 }]]);
  assert.ok(!JSON.stringify(kept).match(/Priya|842|Tuesday|bSamb|bDanb/), "nothing else of the email is kept");
});

test("after enough emails the usual style is suggested, never applied; “Not now” waits for more", async () => {
  const { db, table } = fakeFirestore();
  for (let n = 0; n < STYLE_SAMPLES_NEEDED - 1; n++) outbox(table, `o${n}`, "Hi Priya,\n\nSee you then.\n\nCheers\nDan");
  for (let n = 0; n < STYLE_SAMPLES_NEEDED - 1; n++) await learnFromSentEmail(db, BIZ, `o${n}`, NOON);
  assert.equal(await styleSuggestion(db, BIZ, DEFAULT_STYLE), null, "not enough yet");
  outbox(table, "last", "Hi Sam,\n\nOk.\n\nKind regards\nDan");
  await learnFromSentEmail(db, BIZ, "last", NOON);
  const suggestion = await styleSuggestion(db, BIZ, DEFAULT_STYLE);
  assert.deepEqual(suggestion, { greeting: "Hi {firstName},", greetingUnknown: DEFAULT_STYLE.greetingUnknown, signOff: "Cheers,", samples: STYLE_SAMPLES_NEEDED });
  assert.equal(await styleSuggestion(db, BIZ, { ...DEFAULT_STYLE, signOff: "Cheers," }), null, "already how Sophie writes");
  assert.equal(await styleSuggestion(db, "business-b", DEFAULT_STYLE), null);

  await dismissStyleSuggestion(db, BIZ);
  assert.equal(await styleSuggestion(db, BIZ, DEFAULT_STYLE), null);
  for (let n = 0; n < STYLE_REASK_AFTER; n++) { outbox(table, `m${n}`, "Hi Priya,\n\nOk.\n\nCheers"); await learnFromSentEmail(db, BIZ, `m${n}`, NOON); }
  assert.ok(await styleSuggestion(db, BIZ, DEFAULT_STYLE), "asks again after more emails");
});
