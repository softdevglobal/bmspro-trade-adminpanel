import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { moveCase, openComplaintCase } from "../lib/ai/email/complaints/cases";
import { scanComplaintDeadlines } from "../lib/ai/email/complaints/deadlines";
import {
  ANSWER_OPTIONS, answerStaffQuestion, createStaffQuestion, expireQuestionAfterClose, listStaffQuestions, questionForCase,
  questionText, scanStaffQuestions, STAFF_QUESTIONS_COLLECTION,
} from "../lib/ai/email/complaints/staff-questions";
import { addWorkingMinutes, nextWorkingMoment, type WorkingSchedule } from "../lib/ai/email/complaints/working-time";
import { runRetention } from "../lib/ai/email/retention";
import { fakeFirestore } from "./fake-firestore";

/**
 * Step 9b (docs/sophie-email-learning-and-auto-reply.md §10.4 step 6, §10.7, §10.9 step 9): asking
 * the technician, in their working hours only, with one reminder, a deadline, and an escalation.
 */

const MEL = "Australia/Melbourne";
const BIZ = "business-a";
// Wednesday 25 November 2026, Melbourne (AEDT, UTC+11).
const at = (hour: number, minute = 0, day = 25) => Date.UTC(2026, 10, day, hour - 11, minute);
const SCHEDULE: WorkingSchedule = { startTime: "08:00", endTime: "17:00", offDays: ["saturday", "sunday"], leaveDates: new Set(), timeZone: MEL };

// ---- Working time ---------------------------------------------------------------------------

test("a technician is asked now when they're working, otherwise when they next start", () => {
  assert.equal(nextWorkingMoment(at(10), SCHEDULE), at(10), "mid-morning: now");
  assert.equal(nextWorkingMoment(at(6), SCHEDULE), at(8), "before work: when it starts");
  assert.equal(nextWorkingMoment(at(18), SCHEDULE), at(8, 0, 26), "after work: tomorrow morning");
  assert.equal(nextWorkingMoment(at(18, 0, 27), SCHEDULE), at(8, 0, 30), "Friday night: Monday, not the weekend");
  assert.equal(nextWorkingMoment(at(10), { ...SCHEDULE, leaveDates: new Set(["2026-11-25", "2026-11-26"]) }), at(8, 0, 27), "approved leave is skipped");
  assert.equal(nextWorkingMoment(at(10), { ...SCHEDULE, offDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }), null, "nobody works: the owner decides");
});

test("the answer time counts working hours only", () => {
  assert.equal(addWorkingMinutes(at(10), 240, SCHEDULE), at(14), "4 hours in the same day");
  assert.equal(addWorkingMinutes(at(15), 240, SCHEDULE), at(10, 0, 26), "2 hours left today, 2 tomorrow");
  assert.equal(addWorkingMinutes(at(15), 240, { ...SCHEDULE, offDays: ["thursday"] }), at(10, 0, 27), "skips an off day");
  assert.equal(addWorkingMinutes(at(20), 60, SCHEDULE), at(9, 0, 26), "starts counting when work starts");
});

// ---- The question ---------------------------------------------------------------------------

test("the question is neutral: no accusation, no customer, no quote of what they said", () => {
  const text = questionText("late_arrival", "BK 4K7H2M9P");
  assert.equal(text.title, "Question from Sophie");
  assert.ok(text.body.includes("BK 4K7H2M9P") && text.body.includes("Only your manager sees your answer"));
  assert.ok(!/late|rude|complain|fault|blame|wrong/i.test(text.body.replace("a customer has contacted us", "")), text.body);
  assert.deepEqual([...ANSWER_OPTIONS].length, 6);
});

const make = (db: ReturnType<typeof fakeFirestore>["db"], overrides: Partial<Parameters<typeof createStaffQuestion>[1]> = {}, now = at(18)) =>
  createStaffQuestion(db, {
    businessId: BIZ, caseId: "c".repeat(40), jobId: "j1", jobCode: "BK 1", staffUid: "staff-1", staffName: "Sam", type: "late_arrival", schedule: SCHEDULE, ...overrides,
  }, now);

test("conduct, billing, safety and unclear cases are never put to the technician", async () => {
  const { db, table } = fakeFirestore();
  for (const type of ["conduct", "billing", "safety", "no_update", null] as const) {
    assert.deepEqual(await make(db, { type }), { outcome: "not_asked", reason: "not_askable" }, String(type));
  }
  assert.deepEqual(await make(db, { staffUid: null }), { outcome: "not_asked", reason: "no_technician" });
  assert.deepEqual(await make(db, { schedule: null }), { outcome: "not_asked", reason: "no_working_time" });
  assert.equal(table(STAFF_QUESTIONS_COLLECTION).size, 0);
});

test("a question made at 6 pm waits for the next morning, once", async () => {
  const { db, table } = fakeFirestore();
  const created = await make(db);
  assert.deepEqual(created.outcome === "created" && [created.askAfter, created.deadline], [at(8, 0, 26), at(12, 0, 26)]);
  assert.deepEqual(await make(db), { outcome: "exists", id: created.outcome === "created" ? created.id : "" });
  assert.equal(table(STAFF_QUESTIONS_COLLECTION).size, 1);
  const stored = [...table(STAFF_QUESTIONS_COLLECTION).values()][0];
  assert.deepEqual([stored.status, stored.answer], ["waiting", null]);
  assert.ok(!JSON.stringify(stored).match(/priya|customer.example/i), "nothing about the customer is stored");
});

// ---- The scan: send, remind, end ------------------------------------------------------------

function world() {
  const { db, table } = fakeFirestore();
  const pushed: { uid: string; title: string; body: string; data: Record<string, string> }[] = [];
  const owner: { businessId: string; title: string }[] = [];
  const deps = {
    push: async (uid: string, push: { title: string; body: string; data: Record<string, string> }) => { pushed.push({ uid, ...push }); },
    pushOwner: async (businessId: string, push: { title: string }) => { owner.push({ businessId, title: push.title }); },
  };
  return { db, table, pushed, owner, deps };
}

async function openCase(db: ReturnType<typeof fakeFirestore>["db"], overrides: Record<string, unknown> = {}, now = at(18)) {
  const opened = await openComplaintCase(db, {
    businessId: BIZ, triageId: "t".repeat(40), customerEmail: "priya@customer.example", customerName: "Priya Shah", jobId: "j1", jobNote: null,
    threadId: "t1", type: "late_arrival", summary: "Came late.", status: "open", replyBy: at(13, 0, 27), facts: [], ...overrides,
  } as Parameters<typeof openComplaintCase>[1], now);
  return opened.id;
}

test("send in working hours, remind once halfway, and tell the owner when no answer came", async () => {
  const w = world();
  const caseId = await openCase(w.db);
  await moveCase(w.db, { businessId: BIZ, caseId, to: "waiting_staff", event: "Asked Sam.", by: "sophie" }, at(18));
  await createStaffQuestion(w.db, { businessId: BIZ, caseId, jobId: "j1", jobCode: "BK 1", staffUid: "staff-1", staffName: "Sam", type: "late_arrival", schedule: SCHEDULE }, at(18));

  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(19)), { sent: 0, reminded: 0, expired: 0 }, "not at night");
  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(8, 5, 26)), { sent: 1, reminded: 0, expired: 0 });
  assert.deepEqual(w.pushed.map((item) => [item.uid, item.title, item.data.type]), [["staff-1", "Question from Sophie", "staff_question"]]);
  assert.ok(!/priya|customer\.example/i.test(JSON.stringify(w.pushed)), "the push says nothing about the customer");
  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(8, 10, 26)), { sent: 0, reminded: 0, expired: 0 }, "not sent twice");
  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(10, 5, 26)), { sent: 0, reminded: 1, expired: 0 });
  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(10, 30, 26)), { sent: 0, reminded: 0, expired: 0 }, "one reminder only");
  assert.deepEqual(await scanStaffQuestions(w.db, w.deps, at(12, 5, 26)), { sent: 0, reminded: 0, expired: 1 });
  const question = await questionForCase(w.db, BIZ, caseId);
  assert.deepEqual([question?.status, question?.answer], ["expired", null]);
  const moved = [...w.table("ai_complaint_cases").values()][0];
  assert.equal(moved.status, "waiting_owner");
  assert.ok(JSON.stringify(moved.timeline).includes("Sam hasn't answered yet."));
});

// ---- The answer -----------------------------------------------------------------------------

test("only the technician it was sent to can answer, once, with one of the options", async () => {
  const w = world();
  const caseId = await openCase(w.db);
  await moveCase(w.db, { businessId: BIZ, caseId, to: "waiting_staff", event: "Asked Sam.", by: "sophie" }, at(18));
  const created = await createStaffQuestion(w.db, { businessId: BIZ, caseId, jobId: "j1", jobCode: "BK 1", staffUid: "staff-1", staffName: "Sam", type: "late_arrival", schedule: SCHEDULE }, at(18));
  assert.equal(created.outcome, "created");
  const id = created.outcome === "created" ? created.id : "";
  await scanStaffQuestions(w.db, w.deps, at(9, 0, 26));
  assert.deepEqual((await listStaffQuestions(w.db, BIZ, "staff-1")).map((item) => item.jobCode), ["BK 1"]);
  assert.deepEqual(await listStaffQuestions(w.db, BIZ, "staff-2"), [], "nobody else sees it");
  assert.deepEqual(await listStaffQuestions(w.db, "business-b", "staff-1"), []);

  const run = (overrides: Record<string, unknown>) => answerStaffQuestion(w.db, { businessId: BIZ, staffUid: "staff-1", questionId: id, choice: "Traffic or travel", note: "Accident on the M1", ...overrides }, at(9, 30, 26));
  assert.deepEqual(await run({ staffUid: "staff-2" }), { ok: false, status: 404, error: "Question not found." });
  assert.deepEqual(await run({ businessId: "business-b" }), { ok: false, status: 404, error: "Question not found." });
  assert.deepEqual(await run({ choice: "I was lazy" }), { ok: false, status: 400, error: "Choose one of the answers." });
  assert.deepEqual(await run({ questionId: "../x" }), { ok: false, status: 404, error: "Question not found." });
  assert.deepEqual(await run({}), { ok: true });
  assert.deepEqual(await run({}), { ok: false, status: 409, error: "You've already answered this." });

  const stored = await questionForCase(w.db, BIZ, caseId);
  assert.deepEqual(stored?.answer, { choice: "Traffic or travel", note: "Accident on the M1" });
  const filed = [...w.table("ai_complaint_cases").values()][0];
  assert.equal(filed.status, "waiting_owner");
  assert.ok(!JSON.stringify(filed).includes("Accident"), "the answer stays on the question, never copied into the case or memory");
  assert.deepEqual(await listStaffQuestions(w.db, BIZ, "staff-1"), [], "answered questions leave their list");
});

test("a note is trimmed, and a late answer is still taken", async () => {
  const w = world();
  const caseId = await openCase(w.db);
  const created = await createStaffQuestion(w.db, { businessId: BIZ, caseId, jobId: "j1", jobCode: "BK 1", staffUid: "staff-1", staffName: "Sam", type: "quality", schedule: SCHEDULE }, at(10));
  const id = created.outcome === "created" ? created.id : "";
  await scanStaffQuestions(w.db, w.deps, at(10, 5));
  await scanStaffQuestions(w.db, w.deps, at(15));
  assert.equal((await questionForCase(w.db, BIZ, caseId))?.status, "expired");
  assert.deepEqual(await answerStaffQuestion(w.db, { businessId: BIZ, staffUid: "staff-1", questionId: id, choice: "Something else", note: `  ${"x".repeat(1500)}  ` }, at(16)), { ok: true });
  assert.equal((await questionForCase(w.db, BIZ, caseId))?.answer?.note?.length, 1000);
  assert.ok(JSON.stringify([...w.table("ai_complaint_cases").values()][0].timeline).includes("answered (after the deadline)"));
});

// ---- Escalation and clean-up ----------------------------------------------------------------

test("a case still waiting on the owner after its reply-by time is escalated once, with one push", async () => {
  const w = world();
  const overdue = await openCase(w.db, { triageId: "a".repeat(40), replyBy: at(13, 0, 26), status: "waiting_owner" });
  await openCase(w.db, { triageId: "b".repeat(40), replyBy: at(13, 0, 28), status: "waiting_owner" });
  assert.equal((await scanComplaintDeadlines(w.db, w.deps, at(12, 0, 26))).escalated, 0);
  assert.equal((await scanComplaintDeadlines(w.db, w.deps, at(14, 0, 26))).escalated, 1);
  assert.equal((await scanComplaintDeadlines(w.db, w.deps, at(15, 0, 26))).escalated, 0, "not twice");
  assert.deepEqual(w.owner, [{ businessId: BIZ, title: "A complaint is overdue" }]);
  assert.equal(w.table("ai_complaint_cases").get(overdue)?.status, "escalated");
  const seen = await moveCase(w.db, { businessId: BIZ, caseId: overdue, to: "waiting_owner", event: "The owner saw the overdue case.", by: "owner-a" }, at(16, 0, 26));
  assert.ok(seen.ok);
  assert.equal((await moveCase(w.db, { businessId: BIZ, caseId: overdue, to: "resolved", event: "Resolved.", by: "owner-a" }, at(16, 5, 26))).ok, true);
});

test("the technician's answer goes 90 days after the case closes", async () => {
  const w = world();
  const caseId = await openCase(w.db);
  await createStaffQuestion(w.db, { businessId: BIZ, caseId, jobId: "j1", jobCode: "BK 1", staffUid: "staff-1", staffName: "Sam", type: "quality", schedule: SCHEDULE }, at(10));
  const closedAt = at(10, 0, 26);
  await expireQuestionAfterClose(w.db, BIZ, caseId, closedAt);
  assert.equal(await runRetention(w.db, closedAt + 89 * 24 * 60 * 60_000).then((result) => result.staffQuestions), 0);
  assert.equal(w.table(STAFF_QUESTIONS_COLLECTION).size, 1);
  assert.equal(await runRetention(w.db, closedAt + 91 * 24 * 60 * 60_000).then((result) => result.staffQuestions), 1);
  assert.equal(w.table(STAFF_QUESTIONS_COLLECTION).size, 0);
  assert.ok(Timestamp.now());
});
