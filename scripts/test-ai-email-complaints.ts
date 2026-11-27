import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { runDecisionActions } from "../lib/ai/email/actions";
import type { ActionDeps, ReplySend } from "../lib/ai/email/actions/context";
import { defaultActions, parseActions } from "../lib/ai/email/action-list";
import { canMove, caseIdFor, isClosed, listOpenCases, moveCase, openComplaintCase, replyByLabel, replyByTime } from "../lib/ai/email/complaints/cases";
import { buildFacts, durationLabel, lateness } from "../lib/ai/email/complaints/facts";
import { findComplaintJob, type ComplaintJob } from "../lib/ai/email/complaints/find-job";
import { offerThreshold } from "../lib/ai/email/rules";
import { DEFAULT_STYLE } from "../lib/ai/email/style";
import { renderReply } from "../lib/ai/email/templates";
import type { EmailAction } from "../lib/ai/email/types";
import { fakeFirestore, type Row } from "./fake-firestore";

/**
 * Step 9a (docs/sophie-email-learning-and-auto-reply.md §10.2 to §10.8): finding the job a
 * complaint is about, the fact sheet, the case, the acknowledgement, and the owner's case card.
 */

const MEL = "Australia/Melbourne";
const BIZ = "business-a";
const ID = "a".repeat(40);
// Thursday 26 November 2026, 1 pm in Melbourne (AEDT, UTC+11).
const at = (hour: number, minute = 0, day = 26) => Date.UTC(2026, 10, day, hour - 11, minute);
const NOW = at(13);

const job = (overrides: Partial<ComplaintJob> = {}): ComplaintJob => ({
  id: "j1", code: "BK 4K7H2M9P", status: "completed", serviceName: "Intercom repair", date: "2026-11-24", startTime: "09:00", endTime: "11:00",
  staffUid: "staff-1", staffName: "Sam", visitStartedAt: at(12, 2, 24), visitEndedAt: at(13, 0, 24), missedReason: null, durationMinutes: 120, ...overrides,
});

// ---- Finding the job (§10.4 step 1) ---------------------------------------------------------

test("the reference in the email finds the job, however it's written", () => {
  const jobs = [job(), job({ id: "j2", code: "BK 9Z9Z9Z9Z" })];
  for (const ref of ["BK 4K7H2M9P", "bk4k7h2m9p", "4K7H-2M9P", "job 4k7h2m9p"]) {
    const found = findComplaintJob({ jobRef: ref, jobs, now: NOW, timeZone: MEL });
    assert.deepEqual(found.outcome === "one" && [found.job.id, found.how], ["j1", "reference"], ref);
  }
  assert.deepEqual(findComplaintJob({ jobRef: "BK 0000AAAA", jobs, now: NOW, timeZone: MEL }), { outcome: "ask_owner", reason: "not_found", candidates: [] });
});

test("without a reference: exactly one visit in the last 30 days, or the owner picks", () => {
  const one = findComplaintJob({ jobRef: null, jobs: [job()], now: NOW, timeZone: MEL });
  assert.equal(one.outcome === "one" && one.how, "recent");
  const old = findComplaintJob({ jobRef: null, jobs: [job({ date: "2026-09-01" })], now: NOW, timeZone: MEL });
  assert.deepEqual([old.outcome, old.outcome === "ask_owner" && old.reason], ["ask_owner", "none_recent"]);
  const two = findComplaintJob({ jobRef: null, jobs: [job(), job({ id: "j2", code: "BK 2", date: "2026-11-20" })], now: NOW, timeZone: MEL });
  assert.deepEqual([two.outcome, two.outcome === "ask_owner" && two.reason, two.outcome === "ask_owner" && two.candidates.length], ["ask_owner", "several", 2]);
  const cancelled = findComplaintJob({ jobRef: null, jobs: [job({ status: "cancelled" })], now: NOW, timeZone: MEL });
  assert.equal(cancelled.outcome, "ask_owner", "a cancelled booking can't have gone wrong");
  const future = findComplaintJob({ jobRef: null, jobs: [job({ date: "2026-12-01", status: "scheduled" })], now: NOW, timeZone: MEL });
  assert.equal(future.outcome, "ask_owner");
});

// ---- The fact sheet (§10.4 step 5) -----------------------------------------------------------

test("lateness is worked out against the booked window, in the business time zone", () => {
  assert.equal(durationLabel(52), "52 minutes");
  assert.equal(durationLabel(65), "1 hour 5 minutes");
  assert.equal(lateness(job({ visitStartedAt: at(12, 2, 24) }), MEL), "started 1 hour 2 minutes after the booked window ended");
  assert.equal(lateness(job({ visitStartedAt: at(9, 30, 24) }), MEL), "started 30 minutes after the window opened, inside the booked window");
  assert.equal(lateness(job({ visitStartedAt: at(8, 50, 24) }), MEL), "started at or before the booked window opened");
  assert.equal(lateness(job({ visitStartedAt: null }), MEL), null, "never guessed");
});

test("every fact shows its source, and what's missing says so", () => {
  const facts = buildFacts({ type: "late_arrival", job: job(), checkIns: [{ checkInAt: at(8, 30, 24), checkOutAt: at(13, 15, 24) }, { checkInAt: at(8, 30, 20), checkOutAt: at(15, 0, 20) }], timeZone: MEL });
  const byLabel = Object.fromEntries(facts.map((fact) => [fact.label, fact]));
  assert.equal(byLabel["Booked"].value, "Tuesday 24 November, 9 am to 11 am");
  assert.equal(byLabel["Visit started"].value, "12:02 pm");
  assert.equal(byLabel["Technician checked in"].value, "8:30 am to 1:15 pm", "only that day's check-in");
  assert.match(byLabel["Compared with the booking"].value, /1 hour 2 minutes after the booked window ended/);
  assert.ok(facts.every((fact) => fact.source));
  const bare = buildFacts({ type: "missed_visit", job: job({ status: "missed", visitStartedAt: null, visitEndedAt: null, date: null, staffName: null, missedReason: null }), checkIns: [], timeZone: MEL });
  const missing = Object.fromEntries(bare.map((fact) => [fact.label, fact.value]));
  assert.deepEqual([missing["Booked"], missing["Assigned to"], missing["Visit started"], missing["Why a visit was missed"]], Array(4).fill("not recorded"));
});

// ---- The case (§10.4 step 4, §10.7) ----------------------------------------------------------

test("a reply-by time stays inside the email day", () => {
  assert.equal(replyByLabel(replyByTime(at(13), MEL), MEL), "1 pm Friday 27 November");
  assert.equal(replyByLabel(replyByTime(at(22), MEL), MEL), "9 am Saturday 28 November", "10 pm becomes 9 am the next day");
  assert.equal(replyByLabel(replyByTime(at(3), MEL), MEL), "9 am Friday 27 November", "3 am becomes 9 am that day");
});

test("cases move only the ways §10.7 allows, and closed ones stay closed", () => {
  assert.equal(canMove("waiting_owner", "resolved"), true);
  assert.equal(canMove("waiting_owner", "revisit_booked"), false);
  assert.equal(canMove("resolved", "waiting_owner"), false);
  assert.equal(isClosed("closed_by_owner"), true);
  assert.equal(isClosed("waiting_owner"), false);
});

const newCase = (overrides: Row = {}) => ({
  businessId: BIZ, triageId: ID, customerEmail: "priya@customer.example", customerName: "Priya Shah", jobId: "j1", jobNote: null,
  threadId: "t1", type: "late_arrival" as const, summary: "Technician came late.", status: "waiting_owner" as const, replyBy: at(13, 0, 27), facts: [], ...overrides,
});

test("the same email always gives the same case; it's listed for the owner, then closed by them", async () => {
  const { db, table } = fakeFirestore();
  const first = await openComplaintCase(db, newCase(), NOW);
  const again = await openComplaintCase(db, newCase(), NOW + 1000);
  assert.deepEqual([first.created, again.created, first.id === again.id, first.id === caseIdFor(BIZ, ID)], [true, false, true, true]);
  assert.equal(table("ai_complaint_cases").size, 1);
  assert.equal(table("ai_complaint_cases").get(first.id)?.timeline instanceof Array, true);
  assert.equal((await listOpenCases(db, BIZ)).length, 1);
  assert.equal((await listOpenCases(db, "business-b")).length, 0, "another business never sees it");

  const other = await moveCase(db, { businessId: "business-b", caseId: first.id, to: "resolved", event: "x", by: "u" }, NOW);
  assert.deepEqual(other.ok ? null : other.status, 404);
  const moved = await moveCase(db, { businessId: BIZ, caseId: first.id, to: "resolved", event: "The owner marked it resolved.", by: "owner-a", note: "Called Priya, sorted." }, NOW + 5000);
  assert.ok(moved.ok);
  assert.deepEqual([moved.case.status, moved.case.timeline.at(-1)?.event], ["resolved", "The owner marked it resolved. “Called Priya, sorted.”"]);
  assert.equal((await listOpenCases(db, BIZ)).length, 0);
  const reopen = await moveCase(db, { businessId: BIZ, caseId: first.id, to: "waiting_owner", event: "x", by: "owner-a" }, NOW);
  assert.deepEqual(reopen.ok ? null : reopen.status, 409);
});

// ---- The acknowledgement (§10.4 step 3) ------------------------------------------------------

const FACTS = { businessName: "Northside Workshop", businessPhone: "(02) 9000 0000", ownerFirstName: "Dan", firstName: "Priya Shah", serviceName: null, suburb: null, originalSubject: "Late tech", firstInThread: true, responseBy: "1 pm Friday 27 November" };

test("the acknowledgement shows sympathy, never fault, and gives a time", () => {
  const reply = renderReply("complaint_received", FACTS, DEFAULT_STYLE);
  assert.ok(reply.ok);
  assert.ok(reply.body.includes("I'm Sophie, the AI assistant at Northside Workshop."));
  assert.ok(reply.body.includes("I'm sorry to hear about this, and thank you for letting us know. I've passed it to Dan, and we'll get back to you by 1 pm Friday 27 November."));
  assert.ok(!/we were late|our fault|apolog|refund|discount|credit|technician|sam\b/i.test(reply.body), "no fault, offers or staff");
  assert.deepEqual(renderReply("complaint_received", { ...FACTS, responseBy: null }, DEFAULT_STYLE), { ok: false, missing: ["responseBy"] });
});

test("suggestions: a case and the acknowledgement; for danger, only the owner and the safety reply", () => {
  assert.deepEqual(defaultActions("complaint", { complaintType: "late_arrival" }), [{ kind: "open_complaint_case" }, { kind: "reply", template: "complaint_received" }, { kind: "notify_owner", urgency: "now" }]);
  assert.deepEqual(defaultActions("complaint", { complaintType: "safety" }), [{ kind: "notify_owner", urgency: "now" }]);
  assert.deepEqual(parseActions([{ kind: "open_complaint_case" }]), [{ kind: "open_complaint_case" }]);
  assert.equal(offerThreshold([{ kind: "open_complaint_case" }]), null, "never a rule: the owner decides each complaint");
});

// ---- The action ------------------------------------------------------------------------------

const ENV = { AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false", AI_EMAIL_TRIAGE_ENABLED: "true", AI_EMAIL_COMPLAINTS_ENABLED: "true", AI_EMAIL_AUTO_REPLY_ENABLED: "true", AI_EMAIL_AUTO_ENABLED: "true" };

function setup(options: { actions?: EmailAction[]; jobs?: ComplaintJob[]; triage?: Row; result?: Row; env?: Record<string, string> } = {}) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(ID, {
    businessId: BIZ, connectionId: "conn-a", messageId: "conn-a_m1", threadId: "t1", status: "owner_done", precheck: "none",
    identity: "verified_sender", hasOtherRecipients: false, neverReply: false, customerName: "Priya Shah", subject: "Late tech",
    result: { kind: "complaint", complaintType: "late_arrival", jobRef: null, summary: "Technician came late." , ...options.result }, ...options.triage,
  });
  table("email_messages").set("conn-a_m1", {
    businessId: BIZ, connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", fromAddress: "priya@customer.example",
    subject: "Late tech", messageIdHeader: "<m1@customer.example>", references: "", sentAt: Timestamp.fromMillis(NOW - 60_000),
  });
  table("ai_email_decisions").set(ID, {
    businessId: BIZ, triageId: ID, messageId: "conn-a_m1", confirmedKind: "complaint", actions: options.actions ?? [{ kind: "open_complaint_case" }, { kind: "reply", template: "complaint_received" }],
    actionsStatus: "pending", decidedBy: "owner-a", via: "app", decidedAt: Timestamp.fromMillis(NOW),
  });
  const sent: ReplySend[] = [];
  const deps: ActionDeps = {
    db, env: options.env ?? ENV,
    mailbox: async () => null, pushOwner: async () => undefined, timeZone: async () => MEL, dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    staffSchedule: async () => null,
    staffBusy: async () => [], createReturnJob: async () => ({ ok: false, error: "n/a" }),
    complaintJobs: async () => options.jobs ?? [job()],
    staffCheckIns: async () => [{ checkInAt: at(8, 30, 24), checkOutAt: at(13, 15, 24) }],
    customerRecords: async () => null,
    businessHours: async () => ({ startTime: null, endTime: null, openDays: null, closedDates: [] }),
    resendDocument: async () => ({ ok: false, reason: "not_found" }),
    replyMailbox: async () => ({ async send(input) { sent.push(input); return { ok: true, messageIdHeader: "<s@b.example>" }; } }),
    ensureCustomer: async () => assert.fail("not used"), findCustomer: async () => null,
    createRequest: async () => assert.fail("not used"), cancelRequest: async () => ({ ok: true }),
  };
  const result = (kind: string) => (table("ai_email_decisions").get(ID)?.results as Record<string, { status: string; summary: string }> | undefined)?.[kind];
  const theCase = () => [...table("ai_complaint_cases").values()][0];
  return { table, deps, sent, result, theCase, run: () => runDecisionActions(deps, ID, NOW) };
}

test("a verified customer's complaint: the one recent visit is linked, the facts filed, and the acknowledgement sent", async () => {
  const s = setup();
  assert.equal(await s.run(), "actions:done");
  const filed = s.theCase();
  assert.deepEqual([filed.status, filed.jobId, filed.jobNote, filed.type], ["waiting_owner", "j1", null, "late_arrival"]);
  const facts = filed.facts as { label: string; value: string }[];
  assert.ok(facts.some((fact) => fact.label === "Compared with the booking" && /after the booked window ended/.test(fact.value)));
  assert.match(s.result("open_complaint_case")!.summary, /linked to BK 4K7H2M9P/);
  assert.ok(s.sent[0].bodyText.includes("I'm sorry to hear about this"), s.sent[0].bodyText);
  assert.ok(s.sent[0].bodyText.includes("1 pm Friday 27 November"), "the same time the case shows");
  assert.equal(replyByLabel((filed.replyBy as Timestamp).toMillis(), MEL), "1 pm Friday 27 November");
});

test("with staff questions on, the technician is asked and the case waits for them", async () => {
  const schedule = { startTime: "08:00", endTime: "17:00", offDays: ["saturday", "sunday"], leaveDates: new Set<string>(), timeZone: MEL };
  const s = setup({ env: { ...ENV, AI_STAFF_QUESTIONS_ENABLED: "true" } });
  s.deps.staffSchedule = async () => schedule;
  await s.run();
  assert.equal(s.theCase().status, "waiting_staff");
  assert.match(s.result("open_complaint_case")!.summary, /I'll ask Sam what happened during their working hours/);
  const question = [...s.table("ai_staff_questions").values()][0];
  assert.deepEqual([question.staffUid, question.status, question.jobCode], ["staff-1", "waiting", "BK 4K7H2M9P"]);

  const off = setup({ env: { ...ENV, AI_STAFF_QUESTIONS_ENABLED: "true" }, result: { complaintType: "conduct" } });
  off.deps.staffSchedule = async () => schedule;
  await off.run();
  assert.deepEqual([off.theCase().status, off.table("ai_staff_questions").size], ["waiting_owner", 0], "conduct is the owner's alone");

  const noSwitch = setup();
  noSwitch.deps.staffSchedule = async () => schedule;
  await noSwitch.run();
  assert.deepEqual([noSwitch.theCase().status, noSwitch.table("ai_staff_questions").size], ["waiting_owner", 0]);
});

test("two possible visits, or an unverified sender: a case without a job, and the owner is told why", async () => {
  const two = setup({ jobs: [job(), job({ id: "j2", code: "BK 2", date: "2026-11-20" })] });
  await two.run();
  assert.deepEqual([two.theCase().jobId, two.theCase().jobNote], [null, "More than one visit could be the one they mean. Check which."]);
  assert.deepEqual(two.theCase().facts, []);

  const stranger = setup({ triage: { identity: "none" } });
  await stranger.run();
  assert.deepEqual([stranger.theCase().jobId, stranger.theCase().jobNote], [null, "I only link a job for a verified customer."]);
  assert.equal(stranger.sent.length, 1, "they still get the acknowledgement, which holds no job details");
  assert.ok(!stranger.sent[0].bodyText.includes("BK "));
});

test("the booking reference in the email is used before anything else", async () => {
  const s = setup({ jobs: [job(), job({ id: "j2", code: "BK 9Z9Z9Z9Z", date: "2026-11-20" })], result: { jobRef: "BK 9Z9Z9Z9Z" } });
  await s.run();
  assert.equal(s.theCase().jobId, "j2");
});

test("safety complaints don't open a case; the switch off means nothing is opened; a retry opens one case", async () => {
  const safety = setup({ result: { complaintType: "safety" } });
  await safety.run();
  assert.deepEqual([safety.table("ai_complaint_cases").size, safety.result("open_complaint_case")?.status], [0, "manual"]);

  const off = setup({ env: { ...ENV, AI_EMAIL_COMPLAINTS_ENABLED: "false" } });
  await off.run();
  assert.deepEqual([off.table("ai_complaint_cases").size, off.result("open_complaint_case")?.status], [0, "manual"]);

  const retried = setup({ actions: [{ kind: "open_complaint_case" }] });
  await retried.run();
  retried.table("ai_email_decisions").set(ID, { ...retried.table("ai_email_decisions").get(ID)!, actionsStatus: "pending", results: {} });
  await retried.run();
  assert.equal(retried.table("ai_complaint_cases").size, 1);
});

test("a rule never opens a case by itself", async () => {
  const s = setup({ actions: [{ kind: "open_complaint_case" }] });
  s.table("ai_email_decisions").set(ID, { ...s.table("ai_email_decisions").get(ID)!, via: "rule", decidedBy: "sophie", ruleId: "r".repeat(40), ruleVersion: 1 });
  s.table("ai_email_rules").set("r".repeat(40), { businessId: BIZ, status: "approved", level: "auto", version: 1 });
  s.table("ai_email_triage").set(ID, { ...s.table("ai_email_triage").get(ID)!, status: "auto_done", decisionId: ID });
  assert.match(await s.run(), /^returned:/);
  assert.equal(s.table("ai_complaint_cases").size, 0);
});

// ---- History and the daily summary (§10.4 step 5, §10.9 step 11) ----------------------------------

test("a repeat complaint shows the earlier visits at the same address", () => {
  const home = "1 gate st, ryde, 2112";
  const facts = buildFacts({
    type: "repeat_fault", job: job({ address: home }), checkIns: [], timeZone: MEL,
    otherJobs: [job({ address: home }), job({ id: "j0", code: "BK EARLIER", date: "2026-10-12", address: home }), job({ id: "j9", code: "BK ELSEWHERE", address: "9 other rd, epping, 2121" }), job({ id: "jx", code: "BK OPEN", status: "scheduled", address: home })],
  });
  assert.equal(facts.find((fact) => fact.label === "Earlier visits at this address")?.value, "BK EARLIER (Monday 12 October)");
  const none = buildFacts({ type: "repeat_fault", job: job({ address: home }), checkIns: [], timeZone: MEL, otherJobs: [] });
  assert.equal(none.find((fact) => fact.label === "Earlier visits at this address")?.value, "none recorded");
  assert.ok(!buildFacts({ type: "late_arrival", job: job(), checkIns: [], timeZone: MEL }).some((fact) => fact.label.startsWith("Earlier visits")), "only where it matters");
});

test("open complaints are in the daily summary, with the overdue ones marked", async () => {
  const { buildDailySummary } = await import("../lib/ai/email/summary");
  const summary = buildDailySummary({
    recent: [], waiting: [], now: NOW, timeZone: MEL,
    complaints: [
      { id: "c1", typeLabel: "Late arrival", customerName: "Priya Shah", status: "waiting_owner", replyBy: NOW + 3_600_000 },
      { id: "c2", typeLabel: "Quality of work", customerName: null, status: "escalated", replyBy: NOW - 3_600_000 },
    ],
  });
  assert.deepEqual(summary.openComplaints, [
    { caseId: "c1", line: "Late arrival from Priya Shah: waiting for you", overdue: false },
    { caseId: "c2", line: "Quality of work: overdue, waiting for you", overdue: true },
  ]);
  assert.ok(summary.push?.body.startsWith("2 open complaints"), summary.push?.body);
  assert.deepEqual(buildDailySummary({ recent: [], waiting: [], now: NOW, timeZone: MEL }).openComplaints, []);
});

// ---- "Can we move Thursday's visit?" (§9.1) -------------------------------------------------------

test("a change to a booking: free times for the same technician, the owner told, and nothing on the job changed", async () => {
  const schedule = { startTime: "08:00", endTime: "17:00", offDays: ["sunday"], leaveDates: new Set<string>(), timeZone: MEL };
  const booked = job({ status: "scheduled", date: "2026-11-27", visitStartedAt: null, visitEndedAt: null });
  const make = (options: { jobs?: ComplaintJob[]; triage?: Row } = {}) => {
    const s = setup({ actions: [{ kind: "propose_reschedule" }, { kind: "reply", template: "reschedule_received" }], jobs: options.jobs ?? [booked], triage: options.triage });
    s.deps.staffSchedule = async () => schedule;
    s.deps.businessHours = async () => ({ startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5, 6], closedDates: [] });
    s.deps.staffBusy = async () => [{ start: at(8, 0, 27), end: at(17, 0, 27) }];
    return s;
  };
  const s = make();
  assert.equal(await s.run(), "actions:done");
  const summary = s.result("propose_reschedule")!.summary;
  assert.match(summary, /They want to change BK 4K7H2M9P \(booked Friday 27 November\)\. Sam is free: Thursday 26 November, .*; Saturday 28 November, 8 am to 10 am/);
  assert.match(summary, /I've changed nothing/);
  assert.ok(!summary.includes("Friday 27 November, 8"), "the booked day is full, so it isn't offered");
  assert.ok(s.sent[0].bodyText.includes("We've received your request to change your booking BK 4K7H2M9P. Dan will confirm a new time with you."), s.sent[0].bodyText);
  assert.ok(!/\bon (monday|tuesday|wednesday|thursday|friday|saturday)|moved|agree/i.test(s.sent[0].bodyText.split("Sophie ·")[0]), "no time is agreed in the reply");
  assert.deepEqual(s.table("ai_complaint_cases").size, 0, "not a complaint");
});

test("a change is only looked at for a verified customer with exactly one open booking", async () => {
  const booked = job({ status: "scheduled", date: "2026-11-27", visitStartedAt: null, visitEndedAt: null });
  const run = async (options: { jobs?: ComplaintJob[]; triage?: Row }) => {
    const s = setup({ actions: [{ kind: "propose_reschedule" }, { kind: "reply", template: "reschedule_received" }], jobs: options.jobs ?? [booked], triage: options.triage });
    await s.run();
    return { reply: s.result("reply")?.status, propose: s.result("propose_reschedule")?.status, sent: s.sent.length };
  };
  const manual = { propose: "manual", reply: "needs_details", sent: 0 };
  assert.deepEqual(await run({ triage: { identity: "contact_match" } }), manual, "not verified");
  assert.deepEqual(await run({ triage: { hasOtherRecipients: true } }), manual, "someone else on the email");
  assert.deepEqual(await run({ jobs: [] }), manual, "no open booking");
  assert.deepEqual(await run({ jobs: [booked, { ...booked, id: "j2", code: "BK 2" }] }), manual, "two open bookings");
  assert.deepEqual(await run({ jobs: [job()] }), manual, "a completed job isn't one to move");
});

test("a booking change suggests the times and the acknowledgement; it's never a rule", async () => {
  const { defaultActions } = await import("../lib/ai/email/action-list");
  const { offerThreshold } = await import("../lib/ai/email/rules");
  assert.deepEqual(defaultActions("customer_question", { customerIntent: "booking_change" }).map((action) => action.kind), ["link_thread", "propose_reschedule", "reply", "notify_owner"]);
  assert.equal(offerThreshold([{ kind: "propose_reschedule" }]), null);
});
