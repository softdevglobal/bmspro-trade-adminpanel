import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { runDecisionActions, undoDecisionAction } from "../lib/ai/email/actions";
import type { ActionDeps, ActionMailbox } from "../lib/ai/email/actions/context";
import { actionsKey } from "../lib/ai/email/action-list";
import { cardView } from "../lib/ai/email/cards";
import { BUILT_IN_KIND_OPTIONS, parseClassifierAnswer } from "../lib/ai/email/classify";
import { decideCard, sameDecisionsInARow } from "../lib/ai/email/decisions";
import {
  answerSpotCheck,
  approveRule,
  declineRule,
  mapRule,
  matchRule,
  narrowestScope,
  offerRuleAfterDecision,
  offerThreshold,
  recordRuleDecision,
  REVIEW_AFTER_MS,
  ruleIdFor,
  ruleView,
  setRuleLevel,
  SPOT_CHECK_EVERY,
  type EmailRule,
  type RuleMatch,
  type RuleScope,
} from "../lib/ai/email/rules";
import { senderKey } from "../lib/ai/email/senders";
import { updateEmailSettings } from "../lib/ai/email/settings";
import { buildDailySummary } from "../lib/ai/email/summary";
import { triageEmail, type TriageDeps } from "../lib/ai/email/triage";
import { EMAIL_RISK_FLAGS, type EmailAction, type EmailTriageResult, type ExampleHit } from "../lib/ai/email/types";
import { fakeFirestore, type Row } from "./fake-firestore";

/**
 * Step 7a (docs/sophie-email-learning-and-auto-reply.md §5, §14.3): rule offers, approval of the
 * exact version, matching, automatic decisions, and the ways a rule goes back to asking.
 */

const NOW = Date.UTC(2026, 10, 26, 1, 0);
const BIZ = "business-a";
const ID = (n: number) => n.toString(16).padStart(40, "0");
const KINDS = new Set<string>(BUILT_IN_KIND_OPTIONS.map((option) => option.kind));
const PROMO_ACTIONS: EmailAction[] = [{ kind: "move_folder", folder: "Advertising" }, { kind: "mark_read" }];
const PROMO_KEY = actionsKey(PROMO_ACTIONS);
const PROMO: EmailTriageResult = {
  kind: "promotion", confidence: 0.95, summary: "Spring sale on cable.", urgency: "info",
  customerIntent: null, complaintType: null, friendlyType: null, jobRef: null, extracted: {}, flags: [],
};
const AUTO_ENV = {
  AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false", AI_EMAIL_TRIAGE_ENABLED: "true",
  AI_EMAIL_TRIAGE_DRY_RUN: "false", AI_EMAIL_AUTO_ENABLED: "true", OPENAI_API_KEY: "key",
};
const hits = (n: number, kind = "promotion", key = PROMO_KEY): ExampleHit[] =>
  Array.from({ length: n }, (_, index) => ({ id: `x${index}`, kind: kind as ExampleHit["kind"], summary: "", actionsKey: key, distance: 0.1 }));

function triageRow(n: number, overrides: Row = {}): Row {
  return {
    businessId: BIZ, connectionId: "conn-a", messageId: `conn-a_m${n}`, status: "new", precheck: "none", shadow: false,
    sender: { name: "Deals", address: "deals@supplier.example" }, subject: "Spring sale", identity: "none",
    result: PROMO, aiError: null, codeFlags: [], createdAt: Timestamp.fromMillis(NOW - 60_000), ...overrides,
  };
}

/** The owner taps "Do this" on `count` promotion cards, one second apart. Returns the last decision. */
async function answer(db: ReturnType<typeof fakeFirestore>["db"], table: ReturnType<typeof fakeFirestore>["table"], from: number, count: number, overrides: (n: number) => Row = () => ({}), at = NOW) {
  let last = null;
  for (let n = from; n < from + count; n++) {
    table("ai_email_triage").set(ID(n), triageRow(n, overrides(n)));
    const result = await decideCard(db, { businessId: BIZ, triageId: ID(n), actorUid: "owner-a", via: "app", choice: { choice: "confirm" }, kinds: KINDS }, at + n * 1000);
    assert.ok(result.ok, JSON.stringify(result));
    last = result.decision;
  }
  return last!;
}

function storeRule(table: ReturnType<typeof fakeFirestore>["table"], options: { scope?: RuleScope; actions?: EmailAction[]; customer?: EmailRule["customer"]; stats?: Row; reviewAt?: number; kind?: string } = {}) {
  const scope = options.scope ?? { kind: "any" };
  const actions = options.actions ?? PROMO_ACTIONS;
  const kind = options.kind ?? "promotion";
  const id = ruleIdFor(BIZ, kind, actionsKey(actions), scope);
  table("ai_email_rules").set(id, {
    businessId: BIZ, kind, version: 1, level: "auto", status: "approved", scope, customer: options.customer ?? "any",
    minConfidence: 0.85, requireAgreement: true, exceptFlags: [...EMAIL_RISK_FLAGS], actions, actionsKey: actionsKey(actions),
    basedOnDecisionIds: [ID(1), ID(2), ID(3)], reason: null, approvedBy: "owner-a", approvedAt: Timestamp.fromMillis(NOW - 1000),
    reviewAt: Timestamp.fromMillis(options.reviewAt ?? NOW + REVIEW_AFTER_MS), statusAt: Timestamp.fromMillis(NOW - 1000),
    stats: { autoCount: 0, undoCount: 0, lastUndoAt: null, ...options.stats },
  });
  return id;
}

const reasonOf = (match: RuleMatch) => (match.outcome === "auto" ? null : match.reason);

const matchInput = (overrides: Partial<Parameters<typeof matchRule>[1]> = {}): Parameters<typeof matchRule>[1] => ({
  businessId: BIZ, result: PROMO, codeFlags: [], senderAddress: "deals@supplier.example", senderIsCustomer: false,
  identity: "none", examples: hits(5), ...overrides,
});

// ---- Offers (§5.3) ------------------------------------------------------------------------

test("offer thresholds: 3 for sorting, 5 for records, never for customers or requests", () => {
  assert.equal(offerThreshold(PROMO_ACTIONS), 3);
  assert.equal(offerThreshold([{ kind: "add_bill_item" }, { kind: "mark_read" }]), 5);
  assert.equal(offerThreshold([{ kind: "save_customer" }]), null);
  assert.equal(offerThreshold([{ kind: "create_inspection" }, { kind: "mark_read" }]), null);
  assert.equal(offerThreshold([]), null);
});

test("the narrowest scope: one sender, then a company domain, then anyone", () => {
  const one = narrowestScope(BIZ, [{ address: "deals@supplier.example", identity: "none" }, { address: "DEALS@supplier.example", identity: "none" }]);
  assert.deepEqual(one, { scope: { kind: "sender", senderKey: senderKey(BIZ, "deals@supplier.example"), label: "de***@supplier.example" }, customer: "new" });
  const domain = narrowestScope(BIZ, [{ address: "a@supplier.example", identity: "verified_sender" }, { address: "b@supplier.example", identity: "contact_match" }]);
  assert.deepEqual(domain, { scope: { kind: "domain", domain: "supplier.example" }, customer: "known" });
  const shared = narrowestScope(BIZ, [{ address: "a@gmail.com", identity: "none" }, { address: "b@gmail.com", identity: "verified_sender" }]);
  assert.deepEqual(shared, { scope: { kind: "any" }, customer: "any" }, "never a whole shared mail domain");
});

test("the same answer 3 times in a row is offered as a rule, for that sender, once", async () => {
  const { db, table } = fakeFirestore();
  const second = await answer(db, table, 1, 2);
  assert.equal(await offerRuleAfterDecision(db, second, NOW), null, "2 is not enough");
  const third = await answer(db, table, 3, 1);
  const offer = await offerRuleAfterDecision(db, third, NOW + 10_000);
  assert.ok(offer);
  assert.deepEqual([offer.status, offer.level, offer.version, offer.scope.kind, offer.customer, offer.actionsKey], ["offered", "suggest", 1, "sender", "new", PROMO_KEY]);
  assert.deepEqual(offer.basedOnDecisionIds, [ID(3), ID(2), ID(1)]);
  assert.equal(ruleView(offer).sentence, `Promotion from de***@supplier.example (new senders only): Move it to the "Advertising" folder, then mark it as read.`);
  const fourth = await answer(db, table, 4, 1);
  assert.equal(await offerRuleAfterDecision(db, fourth, NOW + 20_000), null, "never offered twice while waiting");
  assert.equal(table("ai_email_rules").size, 1);
});

test("no offer when Sophie's guesses for the type were wrong, or for types that always go to the owner", async () => {
  const wrong = fakeFirestore();
  let last = null;
  for (let n = 1; n <= 3; n++) {
    wrong.table("ai_email_triage").set(ID(n), triageRow(n, { result: { ...PROMO, kind: "supplier_other" } }));
    const result = await decideCard(wrong.db, { businessId: BIZ, triageId: ID(n), actorUid: "owner-a", via: "app", choice: { choice: "change_kind", kind: "promotion" }, kinds: KINDS }, NOW + n);
    assert.ok(result.ok);
    last = result.decision;
  }
  assert.equal(await offerRuleAfterDecision(wrong.db, last!, NOW), null, "0 of 3 guesses right");

  const complaint = fakeFirestore();
  const decision = await answer(complaint.db, complaint.table, 1, 3, () => ({ result: { ...PROMO, kind: "complaint" } }));
  assert.equal(await offerRuleAfterDecision(complaint.db, { ...decision, actions: [{ kind: "mark_read" }], actionsKey: "mark_read" }, NOW), null);
});

test("“Keep asking me”: offered again only after 3 new same answers", async () => {
  const { db, table } = fakeFirestore();
  const offer = (await offerRuleAfterDecision(db, await answer(db, table, 1, 3), NOW + 5_000))!;
  assert.equal((await declineRule(db, { businessId: BIZ, ruleId: offer.id, version: 1 }, NOW + 6_000)).ok, true);
  assert.equal(await offerRuleAfterDecision(db, await answer(db, table, 7, 2), NOW + 20_000), null);
  const again = await offerRuleAfterDecision(db, await answer(db, table, 9, 1), NOW + 30_000);
  assert.deepEqual([again?.status, again?.version], ["offered", 2]);
});

// ---- Approval (§5.4) ----------------------------------------------------------------------

test("the owner approves the exact version they were shown, and it's reviewed in 90 days", async () => {
  const { db, table } = fakeFirestore();
  const offer = (await offerRuleAfterDecision(db, await answer(db, table, 1, 3), NOW))!;
  const stale = await approveRule(db, { businessId: BIZ, ruleId: offer.id, version: 2, actorUid: "owner-a" }, NOW);
  assert.deepEqual(stale, { ok: false, status: 409, error: "This offer changed since you opened it. Look at it again." });
  const other = await approveRule(db, { businessId: "business-b", ruleId: offer.id, version: 1, actorUid: "owner-b" }, NOW);
  assert.equal(other.ok, false, "another business can't approve it");
  const approved = await approveRule(db, { businessId: BIZ, ruleId: offer.id, version: 1, actorUid: "owner-a" }, NOW);
  assert.ok(approved.ok);
  assert.deepEqual([approved.rule.status, approved.rule.level, approved.rule.approvedBy, approved.rule.reviewAt], ["approved", "auto", "owner-a", NOW + REVIEW_AFTER_MS]);
  assert.equal((await approveRule(db, { businessId: BIZ, ruleId: offer.id, version: 1, actorUid: "owner-a" }, NOW)).ok, false, "approved once");
});

test("moving a rule down needs no confirmation, and getting back to automatic needs a new offer", async () => {
  const { db, table } = fakeFirestore();
  const id = storeRule(table, { scope: { kind: "sender", senderKey: senderKey(BIZ, "deals@supplier.example"), label: "de***@supplier.example" } });
  const down = await setRuleLevel(db, { businessId: BIZ, ruleId: id, level: "suggest" }, NOW);
  assert.ok(down.ok);
  assert.deepEqual([down.rule.level, down.rule.status], ["suggest", "demoted"]);
  assert.equal((await matchRule(db, matchInput(), NOW)).outcome, "suggest");
  const offer = await offerRuleAfterDecision(db, await answer(db, table, 1, 3, () => ({}), NOW + 1000), NOW + 10_000);
  assert.deepEqual([offer?.id, offer?.status, offer?.version], [id, "offered", 2]);
  assert.equal((await setRuleLevel(db, { businessId: BIZ, ruleId: id, level: "off" }, NOW)).ok, true);
  assert.equal((await matchRule(db, matchInput(), NOW)).outcome, "none", "an off rule doesn't even suggest");
});

// ---- Matching (§5.5, §5.6) ----------------------------------------------------------------

test("an approved rule acts alone when everything agrees", async () => {
  const { db, table } = fakeFirestore();
  const id = storeRule(table);
  const match = await matchRule(db, matchInput(), NOW);
  assert.equal(match.outcome, "auto");
  assert.equal(match.outcome === "auto" && match.rule.id, id);
});

test("T16: below the rule's confidence Sophie asks", async () => {
  const { db, table } = fakeFirestore();
  storeRule(table);
  const match = await matchRule(db, matchInput({ result: { ...PROMO, confidence: 0.8 } }), NOW);
  assert.deepEqual([match.outcome, reasonOf(match)], ["suggest", "I'm not sure enough about this one."]);
});

test("T05: a promotion from a saved customer is never handled alone", async () => {
  const { db, table } = fakeFirestore();
  storeRule(table);
  const match = await matchRule(db, matchInput({ senderIsCustomer: true, identity: "verified_sender" }), NOW);
  assert.deepEqual([match.outcome, reasonOf(match)], ["suggest", "It's from a saved customer, so I'm asking."]);
});

test("a risk flag, or past emails that don't agree, send it to the owner", async () => {
  const { db, table } = fakeFirestore();
  storeRule(table);
  const flagged = await matchRule(db, matchInput({ codeFlags: ["asks_to_change_rules"] }), NOW);
  assert.deepEqual([flagged.outcome, reasonOf(flagged)], ["suggest", "Something in it needs you."]);
  const legal = await matchRule(db, matchInput({ result: { ...PROMO, flags: ["legal"] } }), NOW);
  assert.equal(legal.outcome, "suggest");
  const unlike = await matchRule(db, matchInput({ examples: [...hits(2), ...hits(3, "supplier_other")] }), NOW);
  assert.deepEqual([unlike.outcome, reasonOf(unlike)], ["suggest", "It isn't quite like the emails you taught me."]);
  assert.equal((await matchRule(db, matchInput({ examples: [...hits(3), ...hits(2, "supplier_other")] }), NOW)).outcome, "auto", "3 of 5 is enough");
});

test("a rule only covers its own sender, domain and kind of customer", async () => {
  const { db, table } = fakeFirestore();
  storeRule(table, { scope: { kind: "domain", domain: "supplier.example" }, customer: "new" });
  assert.equal((await matchRule(db, matchInput({ senderAddress: "news@supplier.example" }), NOW)).outcome, "auto");
  assert.equal((await matchRule(db, matchInput({ senderAddress: "deals@other.example" }), NOW)).outcome, "none");
  assert.equal((await matchRule(db, matchInput({ identity: "verified_sender" }), NOW)).outcome, "none");
  assert.equal((await matchRule(db, matchInput({ result: { ...PROMO, kind: "supplier_other" } }), NOW)).outcome, "none");
  assert.equal((await matchRule(fakeFirestore().db, matchInput(), NOW)).outcome, "none", "another business's rules never apply");
});

test("two rules that disagree send it to the owner", async () => {
  const { db, table } = fakeFirestore();
  storeRule(table);
  storeRule(table, { scope: { kind: "domain", domain: "supplier.example" }, actions: [{ kind: "ignore" }] });
  const match = await matchRule(db, matchInput({ examples: [...hits(3), ...hits(2, "promotion", "ignore")] }), NOW);
  assert.equal(match.outcome, "suggest");
  assert.equal(match.reason, "Two of your rules disagree about this one.");
});

test("T17: after 90 days the rule asks again, as a new version to renew", async () => {
  const { db, table } = fakeFirestore();
  const id = storeRule(table, { reviewAt: NOW - 1 });
  const match = await matchRule(db, matchInput(), NOW);
  assert.equal(match.outcome, "suggest");
  assert.equal(match.reason, "It's been 90 days: check it's still right, and renew it.");
  const rule = table("ai_email_rules").get(id)!;
  assert.deepEqual([rule.status, rule.level, rule.version], ["offered", "suggest", 2]);
  assert.equal((await approveRule(db, { businessId: BIZ, ruleId: id, version: 2, actorUid: "owner-a" }, NOW)).ok, true);
  assert.equal((await matchRule(db, matchInput(), NOW + 1000)).outcome, "auto");
});

// ---- T08: the card and the rule version -----------------------------------------------------

test("T08: a card built from a rule that changed is rebuilt before the owner's answer runs", async () => {
  const { db, table } = fakeFirestore();
  const id = storeRule(table);
  table("ai_email_triage").set(ID(1), triageRow(1, { ruleId: id, ruleVersion: 1, ruleActions: PROMO_ACTIONS, ruleReason: "I'm not sure enough about this one." }));
  const card = cardView(ID(1), table("ai_email_triage").get(ID(1))!);
  assert.deepEqual([card.fromRule, card.ruleNote, card.suggestions.length], [true, "I'm not sure enough about this one.", 2]);

  // The owner renews the rule with different actions while the card is open.
  table("ai_email_rules").set(id, { ...table("ai_email_rules").get(id)!, version: 2, actions: [{ kind: "ignore" }], actionsKey: "ignore" });
  const refused = await decideCard(db, { businessId: BIZ, triageId: ID(1), actorUid: "owner-a", via: "app", choice: { choice: "confirm" }, kinds: KINDS }, NOW);
  assert.deepEqual(refused.ok ? null : [refused.status, refused.code], [409, "rule_changed"]);
  assert.equal(table("ai_email_decisions").size, 0, "nothing ran on the old version");
  assert.deepEqual([table("ai_email_triage").get(ID(1))!.ruleVersion, table("ai_email_triage").get(ID(1))!.ruleActions], [2, [{ kind: "ignore" }]]);

  const second = await decideCard(db, { businessId: BIZ, triageId: ID(1), actorUid: "owner-a", via: "app", choice: { choice: "confirm" }, kinds: KINDS }, NOW);
  assert.ok(second.ok);
  assert.deepEqual(second.decision.actions, [{ kind: "ignore" }]);
});

// ---- Automatic decisions in the pipeline ----------------------------------------------------

function pipeline(env: Record<string, string>, options: { examples?: ExampleHit[]; settings?: Row } = {}) {
  const { db, table } = fakeFirestore();
  table("email_messages").set("conn-a_m1", {
    businessId: BIZ, connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", unread: true,
    fromName: "Deals", fromAddress: "deals@supplier.example", to: "jobs@business.example", cc: "", subject: "Spring sale",
    sentAt: Timestamp.fromMillis(NOW - 60_000), messageIdHeader: "<sale@supplier.example>", matchMethod: "none",
    customerEmails: [], customerName: null, platformDocument: null,
  });
  table("ai_email_settings").set(BIZ, { enabled: true, enabledAt: Timestamp.fromMillis(NOW - 86_400_000), ...options.settings });
  const notified: string[] = [];
  const deps: TriageDeps = {
    db,
    env,
    loadConnection: async () => ({ id: "conn-a", businessId: BIZ, provider: "google", address: "jobs@business.example", status: "active" }),
    openMailbox: async () => ({
      getHeaders: async () => ({ headers: [], labels: [], inferenceClassification: null }),
      getBody: async () => ({ text: "20% off cable this week.", html: null, attachments: [] }),
    }),
    customers: async () => new Map(),
    threadRecipients: async () => null,
    embed: async () => [0.1, 0.2],
    embeddingModel: "test-embedding-model",
    nearestExamples: async () => options.examples ?? hits(5),
    classify: async () => ({ ok: true, value: { ...parseClassifierAnswer({ ...PROMO, extracted: { customerName: "", phone: "", address: "", suburb: "", service: "", preferredTimes: [], supplierName: "", billAmount: "", billDueDate: "", billReference: "", importantDate: "" } }, KINDS)! } }),
    notify: async (card) => { notified.push(card.triageId); },
  };
  const event = { id: "email.received:conn-a_m1", businessId: BIZ, type: "email.received" as const, entityId: "conn-a_m1" };
  const row = () => [...table("ai_email_triage").entries()][0];
  return { db, table, notified, row, run: () => triageEmail(deps, event, NOW) };
}

test("an approved rule decides alone: the decision, its event, and no card or push", async () => {
  const p = pipeline(AUTO_ENV);
  const ruleId = storeRule(p.table);
  assert.equal(await p.run(), "auto:promotion");
  const [triageId, row] = p.row();
  assert.deepEqual([row.status, row.decisionId, row.ruleId, row.ruleVersion, row.spotCheck], ["auto_done", triageId, ruleId, 1, false]);
  const decision = p.table("ai_email_decisions").get(triageId)!;
  assert.deepEqual([decision.via, decision.decidedBy, decision.ruleId, decision.ruleVersion, decision.actionsStatus, decision.actionsKey],
    ["rule", "sophie", ruleId, 1, "pending", PROMO_KEY]);
  assert.ok(p.table("ai_agent_events").get(`email.decided:${triageId}`), "the runner carries it out");
  assert.equal(p.notified.length, 0);
  assert.equal((p.table("ai_email_rules").get(ruleId)!.stats as Row).autoCount, 1);
  assert.equal(await p.run(), "duplicate", "the same email never decides twice");
});

test("without the automatic switch, in shadow mode or when paused, the rule only suggests", async () => {
  for (const [label, env, settings] of [
    ["auto switch off", { ...AUTO_ENV, AI_EMAIL_AUTO_ENABLED: "false" }, {}],
    ["shadow mode", { ...AUTO_ENV, AI_EMAIL_TRIAGE_DRY_RUN: "true" }, {}],
    ["paused", AUTO_ENV, { paused: true }],
  ] as const) {
    const p = pipeline(env, { settings });
    const ruleId = storeRule(p.table);
    assert.equal(await p.run(), "sorted:promotion", label);
    const [triageId, row] = p.row();
    assert.deepEqual([row.status, row.ruleId, row.ruleActions], ["new", ruleId, PROMO_ACTIONS], label);
    assert.equal(p.table("ai_email_decisions").size, 0, label);
    assert.equal(cardView(triageId, row).fromRule, true, label);
  }
});

test("a type the owner switched off stays in the inbox: no card, no push", async () => {
  const p = pipeline(AUTO_ENV);
  await updateEmailSettings(p.db, BIZ, { kindOff: { kind: "promotion", off: true } }, "owner-a", NOW);
  assert.equal(await p.run(), "kind_off:promotion");
  assert.deepEqual([p.row()[1].status, p.notified.length], ["ignored", 0]);
  const refused = await updateEmailSettings(p.db, BIZ, { kindOff: { kind: "complaint", off: true } }, "owner-a", NOW);
  assert.deepEqual(refused.kindsOff, ["promotion"], "complaints always come to the owner");
});

// ---- Running a rule's decision --------------------------------------------------------------

function runner(options: { env?: Record<string, string>; paused?: boolean; stats?: Row } = {}) {
  const { db, table } = fakeFirestore();
  const ruleId = storeRule(table, { stats: options.stats });
  table("ai_email_triage").set(ID(1), triageRow(1, { status: "auto_done", decisionId: ID(1), ruleId, ruleVersion: 1, result: { ...PROMO, urgency: "today" } }));
  table("email_messages").set("conn-a_m1", {
    businessId: BIZ, connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", unread: true,
    messageIdHeader: "<sale@supplier.example>", sentAt: Timestamp.fromMillis(NOW - 60_000),
  });
  if (options.paused) table("ai_email_settings").set(BIZ, { enabled: true, enabledAt: Timestamp.fromMillis(NOW - 86_400_000), paused: true });
  const calls = { moved: [] as string[][], restored: 0, read: [] as boolean[], pushes: [] as { title: string; body: string }[] };
  const mailbox: ActionMailbox = {
    async moveToFolder(ids, folder) { calls.moved.push([...ids, folder]); },
    async restoreToInbox() { calls.restored++; },
    async setRead(_target, read) { calls.read.push(read); },
    async refresh() {},
  };
  const deps: ActionDeps = {
    db,
    env: options.env ?? AUTO_ENV,
    mailbox: async () => mailbox,
    pushOwner: async (_businessId, push) => { calls.pushes.push(push); },
    timeZone: async () => "Australia/Melbourne",
    dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    staffSchedule: async () => null,
    staffBusy: async () => [], createReturnJob: async () => ({ ok: false, error: "n/a" }),
    complaintJobs: async () => [],
    staffCheckIns: async () => [],
    customerRecords: async () => null,
    businessHours: async () => ({ startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5], closedDates: [] }),
    resendDocument: async () => ({ ok: false, reason: "not_found" }),
    replyMailbox: async () => null,
    ensureCustomer: async () => assert.fail("a rule never saves a customer"),
    findCustomer: async () => null,
    createRequest: async () => assert.fail("a rule never adds a request"),
    cancelRequest: async () => ({ ok: true }),
  };
  const rule = () => table("ai_email_rules").get(ruleId)!;
  const decide = async (at = NOW) => recordRuleDecision(db, {
    businessId: BIZ, triageId: ID(1), messageId: "conn-a_m1",
    rule: mapRule(ruleId, rule()),
    senderKey: senderKey(BIZ, "deals@supplier.example"), guessedKind: "promotion",
  }, at);
  return { db, table, deps, calls, ruleId, rule, decide, run: () => runDecisionActions(deps, ID(1), NOW) };
}

test("a rule's decision runs with the rule's authority", async () => {
  const r = runner();
  await r.decide();
  assert.equal(await r.run(), "actions:done");
  assert.deepEqual([r.calls.moved, r.calls.read], [[["m1", "Advertising"]], [true]]);
  assert.equal(r.table("ai_email_decisions").get(ID(1))!.actionsStatus, "done");
});

test("a rule that changed before Sophie acted sends the email back to the owner, untouched", async () => {
  for (const [label, prepare, reason, code] of [
    ["demoted", (r: ReturnType<typeof runner>) => r.table("ai_email_rules").set(r.ruleId, { ...r.rule(), level: "suggest", status: "demoted" }), "The rule for emails like this changed before I acted, so I'm asking you.", "returned:OK"],
    ["new version", (r: ReturnType<typeof runner>) => r.table("ai_email_rules").set(r.ruleId, { ...r.rule(), version: 2 }), "The rule for emails like this changed before I acted, so I'm asking you.", "returned:OK"],
    ["paused", () => undefined, "You paused me before I got to this one, so it's yours.", "returned:PAUSED"],
    ["auto switch off", () => undefined, "I'm not allowed to act alone right now, so I'm asking you.", "returned:AUTO_NOT_ALLOWED"],
  ] as const) {
    const r = runner({ paused: label === "paused", env: label === "auto switch off" ? { ...AUTO_ENV, AI_EMAIL_AUTO_ENABLED: "false" } : undefined });
    await r.decide();
    prepare(r);
    assert.equal(await r.run(), code, label);
    assert.deepEqual([r.calls.moved.length, r.calls.read.length], [0, 0], label);
    assert.equal(r.table("ai_email_decisions").size, 0, `${label}: the owner's answer replaces it`);
    const row = r.table("ai_email_triage").get(ID(1))!;
    assert.deepEqual([row.status, row.decisionId, row.ruleReason], ["new", null, reason], label);
    assert.equal(r.calls.pushes.length, 1, `${label}: it's a "today" email, so the owner hears about it`);
    const audit = [...r.table("ai_agent_actions").values()].find((item) => item.action === "return_to_owner");
    assert.equal(audit?.status, "suggested", label);
  }
});

test("T07: undoing a rule's action sends the rule back to asking", async () => {
  const r = runner();
  await r.decide();
  await r.run();
  const undone = await undoDecisionAction(r.deps, { businessId: BIZ, triageId: ID(1), kind: "move_folder", actorUid: "owner-a" }, NOW + 1000);
  assert.ok(undone.ok);
  assert.equal(r.calls.restored, 1);
  const rule = r.rule();
  assert.deepEqual([rule.level, rule.status, (rule.stats as Row).undoCount, rule.reason],
    ["suggest", "demoted", 1, "You undid one of mine, so I'll ask you about emails like this again."]);
  assert.equal(r.table("ai_email_decisions").get(ID(1))!.undone, true);
  const next = await matchRule(r.db, matchInput(), NOW + 2000);
  assert.deepEqual([next.outcome, reasonOf(next)], ["suggest", "You undid one of mine, so I'll ask you about emails like this again."]);
});

test("an undone owner answer no longer counts towards a rule", async () => {
  const { db, table } = fakeFirestore();
  await answer(db, table, 1, 3);
  table("ai_email_decisions").set(ID(3), { ...table("ai_email_decisions").get(ID(3))!, undone: true });
  assert.equal(await sameDecisionsInARow(db, BIZ, { confirmedKind: "promotion", actionsKey: PROMO_KEY }), 0);
});

// ---- Spot checks (§5.5) ---------------------------------------------------------------------

test("one automatic decision in every 20 is a spot check; “Wrong” sends the rule back to asking", async () => {
  const r = runner({ stats: { autoCount: SPOT_CHECK_EVERY - 1 } });
  assert.deepEqual(await r.decide(), { created: true, spotCheck: true });
  assert.deepEqual(await r.decide(), { created: false, spotCheck: true }, "one decision per email");
  assert.equal((r.rule().stats as Row).autoCount, SPOT_CHECK_EVERY);

  const summary = buildDailySummary({
    recent: [{ id: ID(1), status: "auto_done", precheck: "none", kind: "promotion", friendlyType: null, senderName: "Deals", senderAddress: "deals@supplier.example", subject: "Spring sale", createdAt: NOW, spotCheck: true }],
    waiting: [], now: NOW, timeZone: "Australia/Melbourne",
  });
  assert.deepEqual(summary.spotChecks, [{ triageId: ID(1), line: "Promotion from Deals: Spring sale" }]);
  assert.ok(summary.push?.body.includes("check one of mine"), summary.push?.body);

  assert.deepEqual(await answerSpotCheck(r.db, { businessId: "business-b", triageId: ID(1), verdict: "wrong" }), { ok: false, status: 404, error: "Not found." });
  assert.deepEqual(await answerSpotCheck(r.db, { businessId: BIZ, triageId: ID(1), verdict: "wrong" }, NOW), { ok: true, demoted: true });
  assert.deepEqual([r.rule().status, r.rule().level], ["demoted", "suggest"]);
  assert.equal(r.table("ai_email_decisions").get(ID(1))!.undone, true);
  assert.equal((await answerSpotCheck(r.db, { businessId: BIZ, triageId: ID(1), verdict: "right" })).ok, false, "answered once");
});

test("“Right” keeps the rule as it is", async () => {
  const r = runner({ stats: { autoCount: SPOT_CHECK_EVERY - 1 } });
  await r.decide();
  assert.deepEqual(await answerSpotCheck(r.db, { businessId: BIZ, triageId: ID(1), verdict: "right" }, NOW), { ok: true, demoted: false });
  assert.deepEqual([r.rule().status, r.rule().level], ["approved", "auto"]);
});
