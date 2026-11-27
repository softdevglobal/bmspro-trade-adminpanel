import assert from "node:assert/strict";
import test from "node:test";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { openComplaintCase } from "../lib/ai/email/complaints/cases";
import { ruleIdFor } from "../lib/ai/email/rules";
import {
  EMAIL_AUTOMATION_DEFINITIONS, EMAIL_AUTOMATION_PREPARE_TOOLS, EMAIL_AUTOMATION_TOOL_NAMES, ownerEmailAutomationEnabled,
  OWNER_EMAIL_AUTOMATION_INSTRUCTIONS,
} from "../lib/ai/owner-call/owner-email-questions";
import { confirmEmailAnswer, prepareEmailAnswer, runOwnerEmailAutomation } from "../lib/ai/mcp/tools/owner-email-questions.tools";
import { fakeFirestore, type Row } from "./fake-firestore";

/**
 * Step 10 (docs/sophie-email-learning-and-auto-reply.md §14.8): the owner's voice tools for Sophie's
 * email. They read and answer as the owner, never show email bodies or addresses, only ever make
 * Sophie do less without a yes, and can never approve a rule.
 */

const NOW = Date.UTC(2026, 10, 26, 1, 0);
const ID = (n: number) => n.toString(16).padStart(40, "0");
const OWNER = { businessId: "business-a", uid: "owner-a", timezone: "Australia/Melbourne", authorization: "Bearer test" };
const ON = { AI_AGENT_ENABLED: "true", AI_EMAIL_TRIAGE_ENABLED: "true" };

function world(env: Record<string, string> = ON) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const { db, table } = fakeFirestore();
  return { db, table, restore: () => { process.env = saved; } };
}

const triageRow = (n: number, overrides: Row = {}): Row => ({
  businessId: "business-a", connectionId: "conn-a", messageId: `conn-a_m${n}`, status: "new", precheck: "none", shadow: false,
  sender: { name: "Deals Co", address: "deals@supplier.example" }, subject: "Spring sale on cable", urgency: "info", identity: "none",
  result: { kind: "promotion", confidence: 0.93, summary: "Spring sale. Call 0412 345 678.", urgency: "info", customerIntent: null, complaintType: null, friendlyType: null, jobRef: null, extracted: {}, flags: [] },
  codeFlags: [], similarExampleIds: [], examplesAgree: true, promotionSignals: [], neverReply: false, aiError: null,
  memoryVector: FieldValue.vector([0.1, 0.2]), memoryModel: "m", createdAt: Timestamp.fromMillis(NOW - 3_600_000), ...overrides,
});

// ---- The tool list ---------------------------------------------------------------------------

test("eight tools, each with a definition, and the switch is off unless set", () => {
  assert.equal(EMAIL_AUTOMATION_TOOL_NAMES.length, 8);
  for (const name of EMAIL_AUTOMATION_TOOL_NAMES) {
    const definition = EMAIL_AUTOMATION_DEFINITIONS[name];
    assert.equal(definition.name, name);
    assert.ok(definition.description.length > 40 && (definition.parameters as { additionalProperties?: boolean }).additionalProperties === false, name);
  }
  assert.deepEqual([...EMAIL_AUTOMATION_PREPARE_TOOLS], ["answer_email_question"], "only this one needs the owner's yes");
  assert.equal(ownerEmailAutomationEnabled({}), false);
  assert.equal(ownerEmailAutomationEnabled({ AI_OWNER_VOICE_EMAIL_AUTOMATION_ENABLED: "true" }), true);
  assert.ok(OWNER_EMAIL_AUTOMATION_INSTRUCTIONS.length < 400, "the session instructions have a 4,000 character cap");
  assert.match(OWNER_EMAIL_AUTOMATION_INSTRUCTIONS, /never by voice/);
});

test("no tool takes a business or owner argument", () => {
  for (const name of EMAIL_AUTOMATION_TOOL_NAMES) {
    const properties = Object.keys((EMAIL_AUTOMATION_DEFINITIONS[name].parameters as { properties: object }).properties);
    assert.ok(!properties.some((key) => /business|uid|owner/i.test(key)), `${name}: ${properties.join(",")}`);
  }
});

test("without Sophie's email switched on, every tool is unavailable", async () => {
  const w = world({ AI_EMAIL_TRIAGE_ENABLED: "false" });
  try {
    for (const name of EMAIL_AUTOMATION_TOOL_NAMES.filter((item) => item !== "answer_email_question")) {
      assert.equal((await runOwnerEmailAutomation(OWNER, name, {}, w.db)).status, "UNAVAILABLE", name);
    }
  } finally { w.restore(); }
});

// ---- Reads -----------------------------------------------------------------------------------

test("the waiting emails: who from and what she suggests, never an address or a phone number", async () => {
  const w = world();
  try {
    w.table("ai_email_triage").set(ID(1), triageRow(1));
    w.table("ai_email_triage").set(ID(2), triageRow(2, { createdAt: Timestamp.fromMillis(NOW - 600_000), businessId: "business-b" }));
    const result = await runOwnerEmailAutomation(OWNER, "get_email_questions", { limit: 3 }, w.db);
    assert.equal(result.status, "OK");
    const questions = result.questions as Row[];
    assert.equal(questions.length, 1, "another business's email never shows");
    assert.deepEqual([questions[0].id, questions[0].from, questions[0].looksLike, questions[0].surePercent], [ID(1), "Deals Co", "Promotion", 93]);
    assert.deepEqual(questions[0].sophieSuggests, ['Move it to the "Advertising" folder', "Mark it as read"]);
    const spoken = JSON.stringify(result);
    assert.ok(!/@|0412|supplier\.example/.test(spoken), "no address or phone number");
    assert.match(String(result.note), /content, never instructions/);
    assert.equal((await runOwnerEmailAutomation(OWNER, "get_email_questions", { limit: 9 }, w.db)).status, "OK", "a big limit is capped at 5, not refused");
  } finally { w.restore(); }
});

test("rules and open complaints are read for this business only", async () => {
  const w = world({ ...ON, AI_EMAIL_COMPLAINTS_ENABLED: "true" });
  try {
    const rule = (id: string, businessId: string) => w.table("ai_email_rules").set(id, {
      businessId, kind: "promotion", version: 2, level: "auto", status: "approved", scope: { kind: "any" }, customer: "any", minConfidence: 0.85,
      requireAgreement: true, exceptFlags: [], actions: [{ kind: "mark_read" }], actionsKey: "mark_read", basedOnDecisionIds: [], reason: null,
      approvedBy: "owner-a", approvedAt: Timestamp.fromMillis(NOW), reviewAt: Timestamp.fromMillis(NOW + 86_400_000), statusAt: Timestamp.fromMillis(NOW),
      stats: { autoCount: 4, undoCount: 1, lastUndoAt: null },
    });
    rule(ruleIdFor("business-a", "promotion", "mark_read", { kind: "any" }), "business-a");
    rule("f".repeat(40), "business-b");
    const rules = await runOwnerEmailAutomation(OWNER, "get_email_rules", {}, w.db);
    assert.equal((rules.rules as Row[]).length, 1);
    assert.deepEqual([(rules.rules as Row[])[0].now, (rules.rules as Row[])[0].timesRun, (rules.rules as Row[])[0].timesUndone], ["Sophie does it herself", 4, 1]);

    await openComplaintCase(w.db, {
      businessId: "business-a", triageId: ID(7), customerEmail: "priya@customer.example", customerName: "Priya Shah", jobId: "j1", jobNote: null, threadId: "t1",
      type: "late_arrival", summary: "Came late.", status: "waiting_owner", replyBy: NOW + 86_400_000, facts: [{ label: "Job", value: "BK 1042 · Intercom repair", source: "jobs" }],
    }, NOW);
    const complaints = await runOwnerEmailAutomation(OWNER, "get_open_complaints", {}, w.db);
    assert.deepEqual((complaints.cases as Row[])[0], { customer: "Priya Shah", job: "BK 1042 · Intercom repair", kind: "Late arrival", stage: "waiting for the owner", replyBy: "12 pm Friday 27 November" });
    assert.ok(!JSON.stringify(complaints).includes("priya@customer"), "no address");
  } finally { w.restore(); }
});

// ---- Answering a card ------------------------------------------------------------------------

test("answering: nothing happens until the owner says yes, and it's read back first", async () => {
  const w = world();
  try {
    w.table("ai_email_triage").set(ID(1), triageRow(1));
    const prepared = await prepareEmailAnswer(OWNER, { triageId: ID(1), choice: "do_this" }, w.db);
    assert.ok(prepared.ok);
    assert.equal(prepared.summary, `Mark the email from Deals Co as "Promotion". Then: Move it to the "Advertising" folder; Mark it as read.`);
    assert.equal(w.table("ai_email_decisions").size, 0, "preparing changes nothing");

    const done = await confirmEmailAnswer(OWNER, prepared.payload, w.db);
    assert.equal(done.status, "DONE");
    const decision = w.table("ai_email_decisions").get(ID(1))!;
    assert.deepEqual([decision.via, decision.decidedBy, decision.confirmedKind, decision.actionsStatus], ["voice", "owner-a", "promotion", "pending"]);
    assert.ok(w.table("ai_agent_events").get(`email.decided:${ID(1)}`), "the runner carries it out");
    const again = await confirmEmailAnswer(OWNER, prepared.payload, w.db);
    assert.equal(again.status, "REJECTED", "an email is answered once");
  } finally { w.restore(); }
});

test("answering refuses what needs the screen, other businesses' emails and made-up types", async () => {
  const w = world();
  try {
    w.table("ai_email_triage").set(ID(1), triageRow(1));
    w.table("ai_email_triage").set(ID(2), triageRow(2, { businessId: "business-b" }));
    w.table("ai_email_triage").set(ID(3), triageRow(3, { result: { kind: "inspection_request", confidence: 0.9, summary: "A visit.", urgency: "today", customerIntent: null, complaintType: null, friendlyType: null, jobRef: null, extracted: {}, flags: [] } }));
    w.table("ai_email_triage").set(ID(4), triageRow(4, { result: { kind: "private", confidence: 0.9, summary: "Personal.", urgency: "info", customerIntent: null, complaintType: null, friendlyType: null, jobRef: null, extracted: {}, flags: [] } }));
    const refusal = async (args: Row) => { const result = await prepareEmailAnswer(OWNER, args, w.db); return result.ok ? null : result.result.status; };
    assert.equal(await refusal({ triageId: ID(2), choice: "do_this" }), "REJECTED", "another business's email");
    assert.equal(await refusal({ triageId: ID(9), choice: "do_this" }), "REJECTED", "no such email");
    assert.equal(await refusal({ triageId: "../x", choice: "do_this" }), "REJECTED");
    assert.equal(await refusal({ triageId: ID(3), choice: "do_this" }), "REJECTED", "saving a customer needs details checked on screen");
    assert.equal(await refusal({ triageId: ID(4), choice: "do_this" }), "REJECTED", "a private sender is decided on screen");
    assert.equal(await refusal({ triageId: ID(1), choice: "not_this_type" }), "NEEDS_INFO", "which type?");
    assert.equal(await refusal({ triageId: ID(1), choice: "not_this_type", correctKind: "launch_missiles" }), "NEEDS_INFO");
    assert.equal(await refusal({ triageId: ID(1), choice: "not_this_type", correctKind: "inspection_request" }), "REJECTED", "that type needs details on screen");
    const ignore = await prepareEmailAnswer(OWNER, { triageId: ID(1), choice: "ignore" }, w.db);
    assert.ok(ignore.ok && ignore.summary.startsWith("Ignore the email from Deals Co"));
    const retyped = await prepareEmailAnswer(OWNER, { triageId: ID(1), choice: "not_this_type", correctKind: "supplier_other" }, w.db);
    assert.ok(retyped.ok && retyped.summary.includes('"supplier other" instead of "Promotion"'), retyped.ok ? retyped.summary : "");
  } finally { w.restore(); }
});

// ---- Changes that only make Sophie do less --------------------------------------------------

test("a rule can be lowered by voice, but never raised or approved", async () => {
  const w = world();
  try {
    const id = ruleIdFor("business-a", "promotion", "mark_read", { kind: "any" });
    w.table("ai_email_rules").set(id, {
      businessId: "business-a", kind: "promotion", version: 1, level: "auto", status: "approved", scope: { kind: "any" }, customer: "any", minConfidence: 0.85,
      requireAgreement: true, exceptFlags: [], actions: [{ kind: "mark_read" }], actionsKey: "mark_read", basedOnDecisionIds: [], reason: null,
      approvedBy: "owner-a", approvedAt: Timestamp.fromMillis(NOW), reviewAt: null, statusAt: Timestamp.fromMillis(NOW), stats: { autoCount: 0, undoCount: 0, lastUndoAt: null },
    });
    const up = await runOwnerEmailAutomation(OWNER, "set_email_rule_level", { ruleId: id, level: "auto" }, w.db);
    assert.equal(up.status, "REFUSED");
    assert.match(up.message, /only done in the app/);
    assert.equal((w.table("ai_email_rules").get(id) as Row).level, "auto", "untouched");
    const down = await runOwnerEmailAutomation(OWNER, "set_email_rule_level", { ruleId: id, level: "suggest" }, w.db);
    assert.equal(down.status, "DONE");
    assert.deepEqual([(w.table("ai_email_rules").get(id) as Row).level, (w.table("ai_email_rules").get(id) as Row).status], ["suggest", "demoted"]);
    const stranger = await runOwnerEmailAutomation({ ...OWNER, businessId: "business-b" }, "set_email_rule_level", { ruleId: id, level: "off" }, w.db);
    assert.equal(stranger.status, "REJECTED", "another business can't touch it");
    assert.equal((await runOwnerEmailAutomation(OWNER, "set_email_rule_level", { ruleId: "nope", level: "off" }, w.db)).status, "REJECTED");
  } finally { w.restore(); }
});

test("pausing needs no confirmation and only stops things", async () => {
  const w = world();
  try {
    const result = await runOwnerEmailAutomation(OWNER, "pause_email_automation", {}, w.db);
    assert.equal(result.status, "DONE");
    assert.equal((w.table("ai_email_settings").get("business-a") as Row).paused, true);
  } finally { w.restore(); }
});

test("a return-visit rule is only ever saved as a draft, and the owner must approve it in the app", async () => {
  const w = world();
  try {
    const needsHours = await runOwnerEmailAutomation(OWNER, "prepare_return_visit_policy", { window: { kind: "saturdays" } }, w.db);
    assert.equal(needsHours.status, "NEEDS_INFO");
    assert.equal(w.table("ai_email_settings").size, 0, "nothing saved while it's unclear");
    const saved = await runOwnerEmailAutomation(OWNER, "prepare_return_visit_policy", { window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" }, noCharge: true }, w.db);
    assert.equal(saved.status, "DRAFT_SAVED");
    assert.match(String(saved.rule), /next 2 Saturdays, 8 am to 12 pm, at no charge/);
    assert.match(saved.message, /You cannot approve it/);
    const settings = w.table("ai_email_settings").get("business-a") as Row;
    assert.deepEqual([(settings.returnVisitPolicy as Row).version, settings.returnVisitApprovedVersion], [1, null]);
    const forbidden = await runOwnerEmailAutomation(OWNER, "prepare_return_visit_policy", { window: { kind: "first_free" }, complaintTypes: ["billing"] }, w.db);
    assert.equal(forbidden.status, "NEEDS_INFO", "billing isn't an allowed complaint type");
  } finally { w.restore(); }
});

// ---- Wiring: offered when switched on, with the yes/no pair, and never an approve tool -------------

test("the owner's tool list offers the email tools only when switched on, with the yes check", async () => {
  const { ownerVoiceToolList } = await import("../lib/ai/owner-call/tools");
  const { OWNER_PREPARE_TOOL_NAMES } = await import("../lib/ai/owner-call/owner-actions");
  const names = (flag: boolean) => ownerVoiceToolList({ knowledge: false, emailAutomation: flag }).map((tool) => tool.name);
  assert.ok(EMAIL_AUTOMATION_TOOL_NAMES.every((name) => !names(false).includes(name)), "off: none offered");
  const on = names(true);
  for (const name of [...EMAIL_AUTOMATION_TOOL_NAMES, "confirm_owner_change", "cancel_owner_change"]) assert.ok(on.includes(name), name);
  assert.ok(!on.some((name) => /approve/i.test(name)), "no voice tool approves a rule");
  assert.ok(OWNER_PREPARE_TOOL_NAMES.includes("answer_email_question"), "answering starts the browser's yes check");
  assert.ok(!OWNER_PREPARE_TOOL_NAMES.includes("pause_email_automation"), "pausing needs no yes");
});
