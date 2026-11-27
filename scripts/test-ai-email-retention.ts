import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { purgeSophieData, retentionCutoffs, RETENTION, runRetention } from "../lib/ai/email/retention";
import { fakeFirestore } from "./fake-firestore";

/**
 * Step 11 (docs/sophie-email-learning-and-auto-reply.md §15): old rows go, memory examples are
 * retired, and disconnecting a mailbox leaves no Sophie data from it.
 */

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 10, 26, 6, 0);
const ts = (at: number) => Timestamp.fromMillis(at);
const ago = (days: number) => ts(NOW - days * DAY);
const ID = (n: number) => n.toString(16).padStart(40, "0");

test("the cut-offs follow §15", () => {
  const cut = retentionCutoffs(NOW);
  assert.deepEqual([RETENTION.triageDays, RETENTION.decisionDays, RETENTION.exampleDays, RETENTION.replyThreadDays], [180, 730, 365, 180]);
  assert.equal(NOW - cut.decisions, 730 * DAY);
  assert.equal(NOW - cut.examples, 365 * DAY);
});

test("the daily sweep removes only what's past its time", async () => {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set("old", { businessId: "b", expireAt: ago(1) });
  table("ai_email_triage").set("fresh", { businessId: "b", expireAt: ts(NOW + 30 * DAY) });
  table("ai_email_decisions").set("old", { businessId: "b", decidedAt: ago(731) });
  table("ai_email_decisions").set("fresh", { businessId: "b", decidedAt: ago(729) });
  table("ai_email_reply_threads").set("old", { businessId: "b", lastReplyAt: ago(181) });
  table("ai_email_reply_threads").set("fresh", { businessId: "b", lastReplyAt: ago(10) });
  table("ai_complaint_cases").set("old", { businessId: "b", expireAt: ago(2) });
  table("ai_complaint_cases").set("fresh", { businessId: "b", expireAt: ts(NOW + DAY) });
  table("ai_email_examples").set("old", { businessId: "b", status: "active", createdAt: ago(366) });
  table("ai_email_examples").set("fresh", { businessId: "b", status: "active", createdAt: ago(364) });
  table("ai_email_examples").set("already", { businessId: "b", status: "retired", createdAt: ago(400), retiredAt: ago(60) });
  // Kept for good: STOP requests, approved rules and the greeting counts.
  table("ai_email_reply_optouts").set("stop", { businessId: "b", createdAt: ago(900) });
  table("ai_email_rules").set("rule", { businessId: "b", status: "approved", statusAt: ago(900) });
  table("ai_email_style_samples").set("b", { businessId: "b", samples: 12, updatedAt: ago(900) });

  const result = await runRetention(db, NOW);
  assert.deepEqual(result, { triage: 1, decisions: 1, examplesRetired: 1, replyThreads: 1, cases: 1, staffQuestions: 0, replySamples: 0 });
  assert.deepEqual([...table("ai_email_triage").keys()], ["fresh"]);
  assert.deepEqual([...table("ai_email_decisions").keys()], ["fresh"]);
  assert.deepEqual([...table("ai_email_reply_threads").keys()], ["fresh"]);
  assert.deepEqual([...table("ai_complaint_cases").keys()], ["fresh"]);
  assert.equal(table("ai_email_examples").size, 3, "examples are retired, never deleted");
  assert.deepEqual(["old", "fresh", "already"].map((id) => table("ai_email_examples").get(id)?.status), ["retired", "active", "retired"]);
  assert.deepEqual([table("ai_email_reply_optouts").size, table("ai_email_rules").size, table("ai_email_style_samples").size], [1, 1, 1]);
  assert.deepEqual(await runRetention(db, NOW), { triage: 0, decisions: 0, examplesRetired: 0, replyThreads: 0, cases: 0, staffQuestions: 0, replySamples: 0 }, "twice is safe");
});

test("a big backlog is cleared in more than one batch", async () => {
  const { db, table } = fakeFirestore();
  for (let n = 0; n < 650; n++) table("ai_email_triage").set(`t${n}`, { businessId: "b", expireAt: ago(5) });
  assert.equal((await runRetention(db, NOW)).triage, 650);
  assert.equal(table("ai_email_triage").size, 0);
});

function seedMailbox(table: ReturnType<typeof fakeFirestore>["table"], business: string, connection: string, n: number, extra: { caseOpen?: boolean } = {}) {
  const id = ID(n);
  table("ai_email_triage").set(id, { businessId: business, connectionId: connection, messageId: `${connection}_m${n}` });
  table("ai_email_decisions").set(id, { businessId: business, triageId: id, details: { fullName: "Priya Shah", phone: "0412 000 000" } });
  table("ai_email_examples").set(id, { businessId: business, status: "active", summary: "Wants a quote." });
  table("email_bill_items").set(id, { businessId: business, supplierName: "Acme" });
  if (extra.caseOpen) table("ai_complaint_cases").set(`case-${n}`, { businessId: business, triageId: id, status: "waiting_owner" });
}

test("disconnecting a mailbox removes everything Sophie holds from it, and nothing else", async () => {
  const { db, table } = fakeFirestore();
  seedMailbox(table, "business-a", "conn-a", 1, { caseOpen: true });
  seedMailbox(table, "business-a", "conn-a", 2);
  seedMailbox(table, "business-a", "conn-other", 3);
  seedMailbox(table, "business-b", "conn-b", 4);
  table("ai_email_reply_threads").set("th1", { businessId: "business-a", connectionId: "conn-a", replyCount: 1 });
  table("ai_email_reply_threads").set("th2", { businessId: "business-a", connectionId: "conn-other", replyCount: 1 });
  table("ai_email_rules").set("rule", { businessId: "business-a", status: "approved" });
  table("ai_email_reply_optouts").set("stop", { businessId: "business-a" });

  const result = await purgeSophieData(db, "business-a", "conn-a");
  assert.deepEqual(result, { triage: 2, examples: 2, decisions: 2, billItems: 2, cases: 1, replyThreads: 1 });
  for (const name of ["ai_email_triage", "ai_email_decisions", "ai_email_examples", "email_bill_items"]) {
    assert.deepEqual([...table(name).keys()].sort(), [ID(3), ID(4)].sort(), name);
  }
  assert.equal(table("ai_complaint_cases").size, 0);
  assert.deepEqual([...table("ai_email_reply_threads").keys()], ["th2"]);
  assert.deepEqual([table("ai_email_rules").size, table("ai_email_reply_optouts").size], [1, 1], "rules and STOP requests are kept");
  assert.deepEqual(await purgeSophieData(db, "business-a", "conn-a"), { triage: 0, examples: 0, decisions: 0, billItems: 0, cases: 0, replyThreads: 0 }, "a second call finds nothing");
});

test("another business's mailbox with the same connection id is never touched", async () => {
  const { db, table } = fakeFirestore();
  seedMailbox(table, "business-b", "conn-a", 9);
  const result = await purgeSophieData(db, "business-a", "conn-a");
  assert.equal(result.triage, 0);
  assert.equal(table("ai_email_triage").size, 1);
});
