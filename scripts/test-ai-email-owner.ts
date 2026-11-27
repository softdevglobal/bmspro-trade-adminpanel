import assert from "node:assert/strict";
import test from "node:test";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { actionsKey, defaultActions, parseActions } from "../lib/ai/email/action-list";
import { cardPush, cardView, CARD_PUSH_GROUP_MS, groupedCardsSince, listCards, notifyNewCard, type CardPush } from "../lib/ai/email/cards";
import { BUILT_IN_KIND_OPTIONS } from "../lib/ai/email/classify";
import { decideCard, sameDecisionsInARow, type CardChoice } from "../lib/ai/email/decisions";
import { emailKindLabel } from "../lib/ai/email/labels";
import type { EmailMemory, NewExample } from "../lib/ai/email/memory";
import { lookupSender } from "../lib/ai/email/senders";
import { buildDailySummary, summaryDue, type SummaryRow } from "../lib/ai/email/summary";
import type { EmailTriageResult } from "../lib/ai/email/types";
import { waitingDigestMessage } from "../lib/email-integration/mailbox/digest";
import { fakeFirestore, type Row } from "./fake-firestore";

const NOW = Date.UTC(2026, 10, 26, 6, 0); // 5 pm in Melbourne (AEDT)
const KINDS = new Set<string>(BUILT_IN_KIND_OPTIONS.map((option) => option.kind));
const ID = (n: number) => n.toString(16).padStart(40, "0");

const RESULT: EmailTriageResult = {
  kind: "inspection_request", confidence: 0.92, summary: "Gate intercom stopped working. Asks for a visit next Tuesday.",
  urgency: "today", customerIntent: null, complaintType: null, friendlyType: null, jobRef: null, extracted: {}, flags: [],
};

function row(overrides: Row = {}): Row {
  return {
    businessId: "business-a", connectionId: "conn-a", messageId: "conn-a_m1", status: "new", precheck: "none", shadow: true,
    sender: { name: "Priya Shah", address: "priya@customer.example" }, subject: "Intercom not working", urgency: "today",
    identity: "verified_sender", customerName: "Priya Shah", result: RESULT, aiError: null, codeFlags: [],
    similarExampleIds: ["a", "b", "c", "d", "e"], examplesAgree: true, promotionSignals: [], neverReply: false,
    memoryVector: FieldValue.vector([0.1, 0.2]), memoryModel: "text-embedding-3-small", pushedAt: null,
    createdAt: Timestamp.fromMillis(NOW - 60_000),
    ...overrides,
  };
}

// ---- The action list --------------------------------------------------------------------

test("each type has a suggestion from the fixed list, and never one that moves money", () => {
  assert.deepEqual(defaultActions("promotion"), [{ kind: "move_folder", folder: "Advertising" }, { kind: "mark_read" }]);
  assert.deepEqual(defaultActions("private"), []);
  assert.deepEqual(defaultActions(null), [{ kind: "notify_owner", urgency: "routine" }]);
  for (const option of BUILT_IN_KIND_OPTIONS) {
    for (const action of defaultActions(option.kind)) assert.notEqual(parseActions([action]), null, `${option.kind}: ${action.kind}`);
  }
});

test("the actions key ignores order but not parameters", () => {
  assert.equal(actionsKey([{ kind: "mark_read" }, { kind: "move_folder", folder: "Advertising" }]), "mark_read+move_folder:advertising");
  assert.equal(actionsKey([{ kind: "move_folder", folder: "advertising" }, { kind: "mark_read" }]), "mark_read+move_folder:advertising");
  assert.notEqual(actionsKey([{ kind: "notify_owner", urgency: "now" }]), actionsKey([{ kind: "notify_owner", urgency: "today" }]));
  assert.equal(actionsKey([]), "none");
});

test("actions from outside are checked against the fixed list", () => {
  assert.deepEqual(parseActions([{ kind: "move_folder", folder: " Council " }, { kind: "add_calendar_reminder", daysBefore: 7 }]),
    [{ kind: "move_folder", folder: "Council" }, { kind: "add_calendar_reminder", daysBefore: 7 }]);
  assert.equal(parseActions([{ kind: "forward_to", address: "x@evil.example" }]), null, "nothing off the list");
  assert.equal(parseActions([{ kind: "mark_paid" }]), null);
  assert.equal(parseActions([{ kind: "move_folder", folder: "../etc" }]), null);
  assert.equal(parseActions([{ kind: "mark_read" }, { kind: "mark_read" }]), null);
  assert.equal(parseActions([{ kind: "ignore" }, { kind: "mark_read" }]), null);
  assert.equal(parseActions([{ kind: "add_calendar_reminder", daysBefore: 400 }]), null);
  assert.equal(parseActions("ignore"), null);
  assert.deepEqual(parseActions([]), []);
});

test("type labels", () => {
  assert.equal(emailKindLabel("inspection_request"), "Site inspection request");
  assert.equal(emailKindLabel("custom:council_permits"), "Council permits");
  assert.equal(emailKindLabel(null), "Not sorted");
});

// ---- Cards (§6.2) -----------------------------------------------------------------------

test("a card shows what Sophie thinks, why, and what she suggests", () => {
  const card = cardView(ID(1), row({ codeFlags: ["asks_to_change_rules"] }));
  assert.equal(card.kindLabel, "Site inspection request");
  assert.equal(card.confidence, 0.92);
  assert.equal(card.why, "It's like 5 earlier emails you handled the same way.");
  assert.equal(card.identity, "Saved customer, verified");
  assert.deepEqual(card.suggestions.map((item) => item.action.kind), ["save_customer", "create_inspection", "reply", "notify_owner"]);
  assert.deepEqual(card.flags, ["Has instructions for Sophie (ignored)"]);
  assert.deepEqual([card.shadow, card.manual, card.askPrivate], [true, null, false]);
});

test("T20: when the AI failed the card asks the owner to choose", () => {
  const card = cardView(ID(1), row({ result: null, aiError: "unreachable" }));
  assert.equal(card.manual, "I couldn't sort this one. Please choose what it is.");
  assert.deepEqual([card.kind, card.suggestions, card.urgency], [null, [], "routine"]);
  assert.match(cardView(ID(1), row({ result: null, aiError: "mailbox_unavailable" })).manual ?? "", /Reconnect the mailbox/);
});

test("a personal email's card shows the sender only and asks about privacy", () => {
  const card = cardView(ID(1), row({ result: { ...RESULT, kind: "private" } }));
  assert.deepEqual([card.askPrivate, card.summary, card.suggestions], [true, null, []]);
});

test("the queue: waiting cards of this business, newest first, without blocked senders", async () => {
  const { db, table } = fakeFirestore();
  const triage = table("ai_email_triage");
  triage.set(ID(1), row({ createdAt: Timestamp.fromMillis(NOW - 3_000) }));
  triage.set(ID(2), row({ createdAt: Timestamp.fromMillis(NOW - 1_000) }));
  triage.set(ID(3), row({ precheck: "blocked" }));
  triage.set(ID(4), row({ status: "owner_done" }));
  triage.set(ID(5), row({ businessId: "business-b" }));
  assert.deepEqual((await listCards(db, "business-a")).map((card) => card.triageId), [ID(2), ID(1)]);
});

test("a push holds the sender and subject only, never the email", () => {
  const push = cardPush({ triageId: ID(1), urgency: "now", senderName: "Mark‮ Lee", subject: `Still broken ${"!".repeat(200)}` });
  assert.equal(push.title, "Urgent email needs you");
  assert.ok(push.body.startsWith("Mark Lee: Still broken"));
  assert.ok(push.body.length <= 40 + 2 + 80);
  assert.deepEqual(push.data, { type: "email_card", link: "/dashboard/emails?tab=sophie", triageId: ID(1) });
});

test("pushes by urgency: U1 at once, U2 once per half hour, U3 and U4 never", async () => {
  const { db, table } = fakeFirestore();
  const sent: CardPush[] = [];
  const send = async (push: CardPush) => { sent.push(push); };
  const card = (n: number, urgency: "now" | "today" | "routine" | "info") => {
    table("ai_email_triage").set(ID(n), row({ result: { ...RESULT, urgency }, urgency }));
    return { businessId: "business-a", triageId: ID(n), urgency, senderName: "Priya", subject: "Hi" };
  };
  assert.equal(await notifyNewCard(db, send, card(1, "routine"), NOW), false);
  assert.equal(await notifyNewCard(db, send, card(2, "info"), NOW), false);
  assert.equal(await notifyNewCard(db, send, card(3, "today"), NOW), true);
  assert.equal(await notifyNewCard(db, send, card(4, "today"), NOW + 60_000), false, "grouped into the digest");
  assert.equal(await notifyNewCard(db, send, card(5, "now"), NOW + 60_000), true, "urgent is never held back");
  assert.equal(await notifyNewCard(db, send, card(6, "today"), NOW + CARD_PUSH_GROUP_MS), true);
  assert.equal(sent.length, 3);
  assert.ok(table("ai_email_triage").get(ID(3))?.pushedAt);
  assert.equal(table("ai_email_triage").get(ID(4))?.pushedAt, null);

  // The digest then announces the grouped one, and nothing already pushed.
  const grouped = await groupedCardsSince(db, "business-a", NOW - 120_000);
  assert.deepEqual(grouped.count, 1);
  assert.deepEqual(waitingDigestMessage(grouped.count, grouped.latest), { title: "1 email is waiting for you", body: "Priya Shah: Intercom not working" });
});

// ---- Decisions (§5.7) -------------------------------------------------------------------

function decisionSetup(rowOverrides: Row = {}) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(ID(1), row(rowOverrides));
  const saved: NewExample[] = [];
  const memory = { save: async (example: NewExample) => { saved.push(example); return example.decisionId; } } as unknown as EmailMemory;
  const decide = (choice: CardChoice, triageId = ID(1), businessId = "business-a") =>
    decideCard(db, { businessId, triageId, actorUid: "owner-a", via: "app", choice, kinds: KINDS, memory }, NOW);
  return { db, table, saved, decide };
}

test("“That's right”: one decision, the email leaves the queue, and Sophie remembers it", async () => {
  const { table, saved, decide } = decisionSetup();
  const result = await decide({ choice: "confirm" });
  assert.ok(result.ok);
  assert.deepEqual([result.decision.confirmedKind, result.decision.matchedSuggestion, result.decision.actionsStatus], ["inspection_request", true, "not_run"]);
  assert.equal(result.decision.actionsKey, "create_inspection+notify_owner:today+reply:request_received+save_customer");
  assert.equal(result.sameInARow, 1);
  assert.deepEqual([table("ai_email_triage").get(ID(1))?.status, table("ai_email_triage").get(ID(1))?.decisionId], ["owner_done", ID(1)]);
  assert.ok(table("ai_email_decisions").has(ID(1)));
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].decisionId, saved[0].kind, saved[0].vector, saved[0].summary], [ID(1), "inspection_request", [0.1, 0.2], RESULT.summary]);

  const again = await decide({ choice: "confirm" });
  assert.deepEqual(again, { ok: false, status: 409, error: "This email was already handled." });
});

test("unticking a suggestion is still the owner's decision, but not a match", async () => {
  const { decide } = decisionSetup();
  const result = await decide({ choice: "confirm", actions: [{ kind: "save_customer" }] });
  assert.ok(result.ok && !result.decision.matchedSuggestion);
});

test("outside shadow mode the actions wait for the runner", async () => {
  const { decide } = decisionSetup({ shadow: false, result: { ...RESULT, kind: "promotion" } });
  const result = await decide({ choice: "confirm" });
  assert.ok(result.ok && result.decision.actionsStatus === "pending");
  // Saving a customer or adding a request needs the owner's confirmed details (step 6b).
  const inspection = await decisionSetup({ shadow: false }).decide({ choice: "confirm" });
  assert.deepEqual(inspection, { ok: false, status: 400, error: "Check the customer's details first." });
});

test("“This isn't a …”, “Do something else” and “Ignore”", async () => {
  const changed = await decisionSetup().decide({ choice: "change_kind", kind: "job_request" });
  assert.ok(changed.ok);
  assert.deepEqual([changed.decision.confirmedKind, changed.decision.guessedKind, changed.decision.matchedSuggestion], ["job_request", "inspection_request", false]);

  const other = await decisionSetup().decide({ choice: "other_actions", actions: [{ kind: "move_folder", folder: "Council" }] });
  assert.ok(other.ok && other.decision.actionsKey === "move_folder:council");

  const ignored = decisionSetup();
  const result = await ignored.decide({ choice: "ignore" });
  assert.ok(result.ok && result.decision.actionsKey === "ignore");
  assert.equal(ignored.table("ai_email_triage").get(ID(1))?.status, "ignored");
});

test("bad answers are refused and nothing is saved", async () => {
  const setup = decisionSetup();
  assert.equal((await setup.decide({ choice: "change_kind", kind: "launch_missiles" })).ok, false);
  assert.equal((await setup.decide({ choice: "other_actions", actions: [{ kind: "forward_to" }] })).ok, false);
  assert.equal((await setup.decide({ choice: "other_actions", actions: [] })).ok, false);
  assert.equal((await setup.decide({ choice: "change_kind", kind: "private" })).ok, false);
  assert.deepEqual(await setup.decide({ choice: "confirm" }, ID(1), "business-b"), { ok: false, status: 404, error: "Email not found." });
  assert.deepEqual(await setup.decide({ choice: "confirm" }, "../x"), { ok: false, status: 404, error: "Email not found." });
  assert.equal(setup.table("ai_email_decisions").size, 0);

  const manual = decisionSetup({ result: null, aiError: "unreachable" });
  assert.equal((await manual.decide({ choice: "confirm" })).ok, false, "a manual card needs a type");
  const chosen = await manual.decide({ choice: "change_kind", kind: "promotion" });
  assert.ok(chosen.ok && chosen.decision.guessedKind === null && chosen.decision.actionsKey === "mark_read+move_folder:advertising");
  assert.equal(manual.saved.length, 0, "no summary, so nothing for memory");
});

test("“Yes, private”: the sender joins the private list and nothing is remembered", async () => {
  const setup = decisionSetup({ result: { ...RESULT, kind: "private" } });
  assert.equal((await setup.decide({ choice: "confirm" })).ok, false);
  const result = await setup.decide({ choice: "mark_private" });
  assert.ok(result.ok && result.decision.confirmedKind === "private" && result.decision.actionsStatus === "not_run");
  assert.equal((await lookupSender(setup.db, "business-a", "priya@customer.example")).private, true);
  assert.equal(setup.saved.length, 0);
});

test("“the same decision N times in a row” is a plain count that stops at a different one", async () => {
  const { db, table } = fakeFirestore();
  const decision = (n: number, actions: string, extra: Row = {}) => table("ai_email_decisions").set(ID(n), {
    businessId: "business-a", confirmedKind: "promotion", actionsKey: actions, replyEdited: false, senderKey: "s1",
    decidedAt: Timestamp.fromMillis(NOW - (10 - n) * 60_000), ...extra,
  });
  decision(1, "mark_read+move_folder:advertising");
  decision(2, "mark_read");
  decision(3, "mark_read+move_folder:advertising");
  decision(4, "mark_read+move_folder:advertising", { senderKey: "s2" });
  decision(5, "mark_read+move_folder:advertising");
  table("ai_email_decisions").set(ID(6), { businessId: "business-b", confirmedKind: "promotion", actionsKey: "x", decidedAt: Timestamp.fromMillis(NOW) });
  const like = { confirmedKind: "promotion" as const, actionsKey: "mark_read+move_folder:advertising" };
  assert.equal(await sameDecisionsInARow(db, "business-a", like), 3);
  assert.equal(await sameDecisionsInARow(db, "business-a", { ...like, senderKey: "s1" }), 1);
  decision(7, "mark_read+move_folder:advertising", { replyEdited: true });
  assert.equal(await sameDecisionsInARow(db, "business-a", like), 0, "an edited reply doesn't count");
});

// ---- The daily summary (§6.4, T18) ---------------------------------------------------------

test("T18: the summary is due once per local day, at the right local time, across a daylight-saving change", () => {
  const melbourne = "Australia/Melbourne";
  // Daylight saving starts in Melbourne on Sun 4 Oct 2026: 5 pm is 07:00 UTC on the 3rd and 06:00 UTC on the 4th.
  const sat5pm = Date.UTC(2026, 9, 3, 7, 0);
  const sun5pm = Date.UTC(2026, 9, 4, 6, 0);
  assert.deepEqual(summaryDue(sat5pm - 60_000, melbourne, 17, null), { due: false, dateKey: "2026-10-03" });
  assert.deepEqual(summaryDue(sat5pm, melbourne, 17, null), { due: true, dateKey: "2026-10-03" });
  assert.equal(summaryDue(sat5pm + 3_600_000, melbourne, 17, "2026-10-03").due, false, "once a day");
  assert.equal(summaryDue(sun5pm - 60_000, melbourne, 17, "2026-10-03").due, false, "4:59 pm on the new clock");
  assert.deepEqual(summaryDue(sun5pm, melbourne, 17, "2026-10-03"), { due: true, dateKey: "2026-10-04" });
  // Daylight saving ends on Sun 5 Apr 2026: 5 pm is 07:00 UTC.
  assert.equal(summaryDue(Date.UTC(2026, 3, 5, 6, 0), melbourne, 17, "2026-04-04").due, false);
  assert.equal(summaryDue(Date.UTC(2026, 3, 5, 7, 0), melbourne, 17, "2026-04-04").due, true);
  // A missed hour still sends it later the same day.
  assert.equal(summaryDue(sat5pm + 4 * 3_600_000, melbourne, 17, null).due, true);
});

const summaryRow = (id: string, overrides: Partial<SummaryRow>): SummaryRow => ({
  id, status: "new", precheck: "none", kind: "job_request", friendlyType: null,
  senderName: "Priya Shah", senderAddress: "priya@customer.example", subject: "Downlights", createdAt: NOW - 3_600_000, ...overrides,
});

test("the summary: waiting, new kinds, kind words, and private only as a count", () => {
  const summary = buildDailySummary({
    recent: [
      summaryRow("p1", { precheck: "private", senderName: null, senderAddress: null, subject: null, kind: null }),
      summaryRow("s1", { precheck: "system", kind: null }),
      summaryRow("s2", { precheck: "system", kind: null }),
      summaryRow("f1", { kind: "friendly", friendlyType: "thanks", senderName: "The Smiths", status: "owner_done" }),
      summaryRow("f2", { kind: "friendly", friendlyType: "closing", status: "owner_done" }),
    ],
    waiting: [
      summaryRow("w1", { kind: "complaint", senderName: "Mark Lee", subject: "Job J-1042 still broken" }),
      summaryRow("u1", { kind: "unknown", senderName: "Council Permits", senderAddress: "permits@council.example" }),
      summaryRow("u2", { kind: "unknown", senderName: "Council Permits", senderAddress: "renewals@council.example" }),
    ],
    now: NOW,
    timeZone: "Australia/Melbourne",
  });
  assert.equal(summary.dateKey, "2026-11-26");
  assert.deepEqual(summary.handled, [{ label: "2 automatic notices ignored", count: 2 }]);
  assert.equal(summary.waitingTotal, 1);
  assert.equal(summary.waiting[0].line, "Complaint from Mark Lee: Job J-1042 still broken");
  assert.equal(summary.waiting[0].since, "4:00 pm");
  assert.deepEqual(summary.newKinds, [{ label: "2 emails from Council Permits", count: 2, triageIds: ["u1", "u2"] }]);
  assert.deepEqual(summary.kindWords, ["The Smiths said thanks"]);
  assert.equal(summary.privateCount, 1);
  assert.equal(summary.push?.body, "1 waiting for you · 1 new kind of email to teach me · 2 handled · 1 kind message · 1 kept private");
  assert.ok(!JSON.stringify(summary).includes("p1"), "nothing about the private email but the count");
});

test("an empty day sends no push", () => {
  assert.equal(buildDailySummary({ recent: [], waiting: [], now: NOW, timeZone: "Australia/Melbourne" }).push, null);
});
