import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import type { ActionDeps, ReplySend } from "../lib/ai/email/actions/context";
import { openComplaintCase } from "../lib/ai/email/complaints/cases";
import type { ComplaintJob } from "../lib/ai/email/complaints/find-job";
import { approveReturnVisitPolicy, getPolicies, saveCompensationGuide, saveReturnVisitPolicy, withdrawReturnVisitPolicy } from "../lib/ai/email/complaints/policies";
import { bookReturnVisit, linkReturnVisit, offerReturnVisit, previewReturnVisit } from "../lib/ai/email/complaints/return-visit";
import { renderReply } from "../lib/ai/email/templates";
import { DEFAULT_STYLE } from "../lib/ai/email/style";
import { fakeFirestore } from "./fake-firestore";

/**
 * Step 9c (docs/sophie-email-learning-and-auto-reply.md §10.10): saving and approving the rule, the
 * times it finds, the owner's offer, and linking the booked visit.
 */

const MEL = "Australia/Melbourne";
const BIZ = "business-a";
// Thursday 26 November 2026, 1 pm in Melbourne (AEDT, UTC+11).
const at = (hour: number, minute = 0, day = 26) => Date.UTC(2026, 10, day, hour - 11, minute);
const NOW = at(13);
const TRIAGE = "t".repeat(40);

const ORIGINAL: ComplaintJob = {
  id: "j1", code: "BK 4K7H2M9P", status: "completed", serviceName: "Intercom repair", date: "2026-11-24", startTime: "09:00", endTime: "11:00",
  staffUid: "staff-1", staffName: "Sam", visitStartedAt: at(12, 2, 24), visitEndedAt: at(13, 0, 24), missedReason: null, durationMinutes: 120,
};
const NEW_VISIT: ComplaintJob = { ...ORIGINAL, id: "j2", code: "BK 7R7R7R7R", status: "scheduled", date: "2026-11-28", visitStartedAt: null, visitEndedAt: null };

const SATURDAYS = { window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" }, noCharge: true };

async function world(options: { approve?: boolean; busy?: { start: number; end: number }[]; jobs?: ComplaintJob[] } = {}) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(TRIAGE, {
    businessId: BIZ, connectionId: "conn-a", messageId: "conn-a_m1", threadId: "t1", precheck: "none", identity: "verified_sender",
    hasOtherRecipients: false, neverReply: false, customerName: "Priya Shah", subject: "Still not working", result: { kind: "complaint" },
  });
  table("email_messages").set("conn-a_m1", {
    businessId: BIZ, connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox", fromAddress: "priya@customer.example",
    subject: "Still not working", messageIdHeader: "<m1@customer.example>", references: "", sentAt: Timestamp.fromMillis(NOW - 3_600_000),
  });
  table("jobs").set("j1", { businessId: BIZ });
  table("jobs").set("j2", { businessId: BIZ });
  const opened = await openComplaintCase(db, {
    businessId: BIZ, triageId: TRIAGE, customerEmail: "priya@customer.example", customerName: "Priya Shah", jobId: "j1", jobNote: null, threadId: "t1",
    type: "work_unfinished", summary: "Intercom still not working.", status: "open", replyBy: at(13, 0, 27), facts: [],
    measures: { jobDate: "2026-11-24", jobStatus: "completed", minutesAfterWindowStart: 182, minutesAfterWindowEnd: 62, durationMinutes: 120, staffUid: "staff-1" },
  }, NOW - 7_200_000);
  const caseRef = table("ai_complaint_cases").get(opened.id)!;
  table("ai_complaint_cases").set(opened.id, { ...caseRef, status: "waiting_owner" });

  if (options.approve !== false) {
    const saved = await saveReturnVisitPolicy(db, { businessId: BIZ, policy: SATURDAYS, actorUid: "owner-a" }, NOW);
    assert.ok(saved.ok);
    assert.ok((await approveReturnVisitPolicy(db, { businessId: BIZ, version: saved.value.version, actorUid: "owner-a" }, NOW)).ok);
  }
  const sent: ReplySend[] = [];
  const created: Parameters<ActionDeps["createReturnJob"]>[0][] = [];
  const deps: ActionDeps = {
    db, env: { AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false", AI_EMAIL_TRIAGE_ENABLED: "true", AI_EMAIL_COMPLAINTS_ENABLED: "true" },
    mailbox: async () => null, pushOwner: async () => undefined, timeZone: async () => MEL, dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    complaintJobs: async () => options.jobs ?? [ORIGINAL, NEW_VISIT],
    staffSchedule: async () => ({ startTime: "08:00", endTime: "17:00", offDays: ["sunday"], leaveDates: new Set<string>(), timeZone: MEL }),
    staffBusy: async () => options.busy ?? [],
    createReturnJob: async (input) => { created.push(input); table("jobs").set("j3", { businessId: BIZ }); return { ok: true, jobId: "j3", code: "BK RETURN1" }; },
    staffCheckIns: async () => [],
    customerRecords: async () => null,
    businessHours: async () => ({ startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5, 6], closedDates: [] }),
    resendDocument: async () => ({ ok: false, reason: "not_found" }),
    replyMailbox: async () => ({ async send(input) { sent.push(input); return { ok: true, messageIdHeader: "<s@b.example>" }; } }),
    ensureCustomer: async () => assert.fail("not used"), findCustomer: async () => null,
    createRequest: async () => assert.fail("not used"), cancelRequest: async () => ({ ok: true }),
  };
  return { db, table, deps, sent, created, caseId: opened.id, theCase: () => table("ai_complaint_cases").get(opened.id)! };
}

// ---- Saving and approving the rule ----------------------------------------------------------

test("a new version of the rule isn't used until the owner approves that exact version", async () => {
  const { db } = fakeFirestore();
  const first = await saveReturnVisitPolicy(db, { businessId: BIZ, policy: SATURDAYS, actorUid: "owner-a" }, NOW);
  assert.ok(first.ok && first.value.version === 1);
  assert.equal((await getPolicies(db, BIZ)).approved, null, "saved is not approved");
  assert.deepEqual(await approveReturnVisitPolicy(db, { businessId: BIZ, version: 2, actorUid: "owner-a" }, NOW), { ok: false, status: 409, error: "This rule changed since you opened it. Look at it again." });
  assert.ok((await approveReturnVisitPolicy(db, { businessId: BIZ, version: 1, actorUid: "owner-a" }, NOW)).ok);
  assert.equal((await getPolicies(db, BIZ)).approved?.version, 1);
  const second = await saveReturnVisitPolicy(db, { businessId: BIZ, policy: { ...SATURDAYS, noCharge: false }, actorUid: "owner-a" }, NOW);
  assert.ok(second.ok && second.value.version === 2);
  assert.equal((await getPolicies(db, BIZ)).approved, null, "a change withdraws the approval");
  await approveReturnVisitPolicy(db, { businessId: BIZ, version: 2, actorUid: "owner-a" }, NOW);
  await withdrawReturnVisitPolicy(db, BIZ);
  assert.equal((await getPolicies(db, BIZ)).approved, null);
  const bad = await saveReturnVisitPolicy(db, { businessId: BIZ, policy: { window: { kind: "first_free", withinDays: 7 }, appliesTo: ["billing"] }, actorUid: "owner-a" }, NOW);
  assert.equal(bad.ok, false);
  assert.equal((await saveCompensationGuide(db, { businessId: BIZ, entries: [{ label: "Refund all", when: { kind: "missed_visit" }, proposal: { kind: "refund_all" } }], actorUid: "owner-a" }, NOW)).ok, false);
});

// ---- The preview -----------------------------------------------------------------------------

test("the card shows the two Saturdays that fit, and what the compensation guide says", async () => {
  const w = await world();
  await saveCompensationGuide(w.db, { businessId: BIZ, entries: [
    { label: "Over an hour late: $30 off", when: { kind: "late_over_minutes", minutes: 60 }, proposal: { kind: "discount", amountAud: 30 } },
    { label: "Over 3 hours late: waive the call-out fee", when: { kind: "late_over_minutes", minutes: 180 }, proposal: { kind: "waive_call_out_fee" } },
  ], actorUid: "owner-a" }, NOW);
  const preview = await previewReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, ownerConfirmsOurWork: true }, NOW);
  assert.ok(preview);
  assert.equal(preview.policyApproved, true);
  assert.deepEqual(preview.slots.map((slot) => slot.label), ["Saturday 28 November, 8 am to 10 am", "Saturday 5 December, 8 am to 10 am"], "as long as the original visit");
  assert.deepEqual(preview.applies, { applies: true });
  assert.deepEqual(preview.compensation.map((item) => [item.verdict, item.proposal]), [["applies", "take $30.00 off"], ["doesnt_apply", null]]);
  assert.equal(preview.noCharge, true);
  const unconfirmed = await previewReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, ownerConfirmsOurWork: false }, NOW);
  assert.match(unconfirmed!.applies && !unconfirmed!.applies.applies ? unconfirmed!.applies.reason : "", /Nobody has confirmed/);
  assert.equal(await previewReturnVisit(w.deps, { businessId: "business-b", caseId: w.caseId, ownerConfirmsOurWork: true }, NOW), null, "another business never sees it");
});

test("without an approved rule, or without a free time, there are no times and a reason why", async () => {
  const none = await world({ approve: false });
  const preview = await previewReturnVisit(none.deps, { businessId: BIZ, caseId: none.caseId, ownerConfirmsOurWork: true }, NOW);
  assert.deepEqual([preview?.policyApproved, preview?.slots.length, preview?.noSlotsReason], [false, 0, "Approve your return-visit rule in Settings → Sophie first."]);
  const full = await world({ busy: [{ start: at(0, 0, 27), end: at(23, 59, 31) }, { start: at(0, 0, 1) + 7 * 86_400_000 * 4, end: at(23, 59, 1) + 7 * 86_400_000 * 6 }] });
  const crowded = await previewReturnVisit(full.deps, { businessId: BIZ, caseId: full.caseId, ownerConfirmsOurWork: true }, NOW);
  assert.deepEqual(crowded?.slots, []);
  assert.match(crowded?.noSlotsReason ?? "", /No free time that fits your rule for Sam/);
});

// ---- The offer -------------------------------------------------------------------------------

const SAT1 = { date: "2026-11-28", startTime: "08:00" };
const SAT2 = { date: "2026-12-05", startTime: "08:00" };

test("the owner's offer emails the chosen times, once, and the case waits for the customer", async () => {
  const w = await world();
  const refused = await offerReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a", chosen: [SAT1], ownerConfirmsOurWork: false }, NOW);
  assert.deepEqual(refused, { ok: false, status: 409, error: "Confirm it's our work first." });
  const gone = await offerReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a", chosen: [{ date: "2026-11-28", startTime: "09:30" }], ownerConfirmsOurWork: true }, NOW);
  assert.deepEqual(gone, { ok: false, status: 409, error: "One of those times isn't free any more. Look at the times again." });
  assert.equal(w.sent.length, 0);

  const done = await offerReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a", chosen: [SAT1, SAT2], ownerConfirmsOurWork: true }, NOW);
  assert.deepEqual(done, { ok: true, offered: ["Saturday 28 November, 8 am to 10 am", "Saturday 5 December, 8 am to 10 am"] });
  assert.equal(w.sent.length, 1);
  const body = w.sent[0].bodyText;
  assert.ok(body.includes("we can come back on Saturday 28 November, 8 am to 10 am or Saturday 5 December, 8 am to 10 am."), body);
  assert.ok(body.includes("Dan will confirm it") && body.includes("AI assistant"), body);
  assert.ok(!/\$|free of charge|no charge|refund|sorry we|our fault/i.test(body), "no price, no fault");
  assert.equal(w.sent[0].to, "priya@customer.example");
  assert.equal(w.theCase().status, "waiting_customer");
  assert.deepEqual((w.theCase().remedy as { kind: string; noCharge: boolean; offered: string[] }).kind, "return_visit");
  assert.equal((w.theCase().remedy as { noCharge: boolean }).noCharge, true);
  const again = await offerReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a", chosen: [SAT1], ownerConfirmsOurWork: true }, NOW);
  assert.deepEqual(again, { ok: false, status: 409, error: "A return visit was already offered for this case." });
  assert.equal(w.sent.length, 1);
});

test("the offer template needs times, and never offers more than three", () => {
  const facts = { businessName: "Northside Workshop", businessPhone: null, ownerFirstName: "Dan", firstName: null, serviceName: null, suburb: null, originalSubject: "x", firstInThread: true };
  assert.deepEqual(renderReply("complaint_return_visit_offer", { ...facts, offerTimes: [] }, DEFAULT_STYLE), { ok: false, missing: ["offerTimes"] });
  const many = renderReply("complaint_return_visit_offer", { ...facts, offerTimes: ["a", "b", "c", "d", "e"] }, DEFAULT_STYLE);
  assert.ok(many.ok && many.body.includes("a or b or c.") && !many.body.includes("or d"));
});

// ---- Linking the booked visit ---------------------------------------------------------------

test("the booked visit is linked to the case, and only the customer's own other job can be", async () => {
  const w = await world();
  const self = await linkReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, jobId: "j1", actorUid: "owner-a" }, NOW);
  assert.deepEqual(self, { ok: false, status: 409, error: "That's the original job. Choose the new visit." });
  const stranger = await linkReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, jobId: "j9", actorUid: "owner-a" }, NOW);
  assert.deepEqual(stranger, { ok: false, status: 404, error: "That visit isn't one of this customer's open jobs." });
  const other = await linkReturnVisit(w.deps, { businessId: "business-b", caseId: w.caseId, jobId: "j2", actorUid: "owner-b" }, NOW);
  assert.equal(other.ok, false);

  assert.deepEqual(await linkReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, jobId: "j2", actorUid: "owner-a" }, NOW), { ok: true });
  assert.deepEqual(w.table("jobs").get("j2"), { businessId: BIZ, linkedJobId: "j1", returnVisit: true }, "only the link is written, never the price");
  assert.equal(w.theCase().status, "revisit_booked");
  assert.equal((w.theCase().remedy as { revisitJobId: string }).revisitJobId, "j2");
});

// ---- After the visit (§10.7) -----------------------------------------------------------------

test("when the linked return visit is completed the case moves to follow-up and the owner is told once", async () => {
  const { noteReturnVisitCompleted, sendFollowUp } = await import("../lib/ai/email/complaints/follow-up");
  const { moveCase } = await import("../lib/ai/email/complaints/cases");
  const w = await world();
  const pushes: string[] = [];
  const push = async (businessId: string, message: { title: string; data: Record<string, string> }) => { pushes.push(`${businessId}:${message.title}:${message.data.caseId === w.caseId}`); };

  assert.equal(await noteReturnVisitCompleted(w.db, { businessId: BIZ, jobId: "j2" }, push, NOW), false, "an unlinked visit is none of its business");
  await linkReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, jobId: "j2", actorUid: "owner-a" }, NOW);
  assert.equal(await noteReturnVisitCompleted(w.db, { businessId: "business-b", jobId: "j2" }, push, NOW), false, "another business");
  assert.equal(await noteReturnVisitCompleted(w.db, { businessId: BIZ, jobId: "j2" }, push, NOW + 1000), true);
  assert.equal(w.theCase().status, "follow_up");
  assert.deepEqual(pushes, [`${BIZ}:Return visit done:true`]);
  assert.equal(await noteReturnVisitCompleted(w.db, { businessId: BIZ, jobId: "j2" }, push, NOW + 2000), false, "told once");

  // The owner's tap sends the follow-up, once, as Sophie, with no promise or admission.
  const refused = await sendFollowUp(w.deps, { businessId: "business-b", caseId: w.caseId, actorUid: "owner-b" }, NOW);
  assert.equal(refused.ok, false);
  assert.deepEqual(await sendFollowUp(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a" }, NOW + 3000), { ok: true });
  assert.equal(w.sent.length, 1);
  const body = w.sent[0].bodyText;
  assert.ok(body.includes("return visit is finished") && body.includes("Dan will take another look") && body.includes("AI assistant"), body);
  assert.ok(!/\$|refund|sorry we|our fault|discount|free of charge/i.test(body), "no money, no fault");
  assert.ok(JSON.stringify(w.theCase().timeline).includes("Asked the customer if it's fixed."));
  assert.equal((await sendFollowUp(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a" }, NOW + 4000)).ok, true, "a second tap is harmless: the same email key is a no-op in the outbox");
  assert.deepEqual([...new Set(w.sent.map((item) => item.idempotencyKey))].length, 1, "every tap uses one key, so the outbox sends it once");

  // The customer's answer is an ordinary email: the owner marks it fixed, or reopens it.
  const reopened = await moveCase(w.db, { businessId: BIZ, caseId: w.caseId, to: "waiting_owner", event: "The customer says it's still not fixed.", by: "owner-a" }, NOW + 5000);
  assert.ok(reopened.ok);
});

test("a follow-up can only go once the return visit is finished", async () => {
  const { sendFollowUp } = await import("../lib/ai/email/complaints/follow-up");
  const w = await world();
  assert.deepEqual(await sendFollowUp(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a" }, NOW), { ok: false, status: 409, error: "The return visit isn't finished yet." });
  assert.equal(w.sent.length, 0);
});

// ---- Booking the time the customer picked ------------------------------------------------------

async function offered() {
  const w = await world();
  const result = await offerReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, actorUid: "owner-a", chosen: [SAT1, SAT2], ownerConfirmsOurWork: true }, NOW);
  assert.ok(result.ok);
  return w;
}

test("the owner books the time the customer picked: through the job path, no price, linked, and once", async () => {
  const w = await offered();
  assert.deepEqual((w.theCase().remedy as { offeredSlots: { startTime: string; endTime: string }[] }).offeredSlots.map((slot) => `${slot.startTime}-${slot.endTime}`), ["08:00-10:00", "08:00-10:00"]);
  assert.deepEqual(await bookReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, ...SAT2, actorUid: "owner-a" }, NOW + 1000), { ok: true, code: "BK RETURN1" });
  assert.deepEqual(w.created, [{ businessId: BIZ, originalJobId: "j1", date: "2026-12-05", startTime: "08:00", endTime: "10:00", actorUid: "owner-a" }]);
  assert.deepEqual(w.table("jobs").get("j3"), { businessId: BIZ, linkedJobId: "j1", returnVisit: true, noCharge: true });
  assert.equal(w.theCase().status, "revisit_booked");
  assert.equal((w.theCase().remedy as { revisitJobId: string }).revisitJobId, "j3");
  assert.ok(JSON.stringify(w.theCase().timeline).includes("Return visit booked for Saturday 5 December, 8 am to 10 am: BK RETURN1."));
  const again = await bookReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, ...SAT1, actorUid: "owner-a" }, NOW + 2000);
  assert.equal(again.ok, false);
  assert.equal(w.created.length, 1, "never booked twice");
});

test("booking is refused for a time that wasn't offered, one that's gone, another business, no offer, or a chargeable visit", async () => {
  const refused = async (w: Awaited<ReturnType<typeof offered>>, overrides: Record<string, unknown> = {}) => {
    const result = await bookReturnVisit(w.deps, { businessId: BIZ, caseId: w.caseId, ...SAT1, actorUid: "owner-a", ...overrides } as Parameters<typeof bookReturnVisit>[1], NOW + 1000);
    return result.ok ? null : result.error;
  };
  const w = await offered();
  assert.equal(await refused(w, { startTime: "09:00" }), "That isn't one of the times you offered.");
  assert.equal(await refused(w, { businessId: "business-b" }), "Case not found.");
  assert.equal(w.created.length, 0);

  const early = await world();
  assert.equal(await refused(early as never), "Offer the customer times first.");

  const taken = await offered();
  // The technician got booked at that time since the offer.
  taken.deps.staffBusy = async () => [{ start: at(7, 30, 28), end: at(10, 30, 28) }];
  assert.equal(await refused(taken), "That time isn't free any more. Book another time in the calendar, then link it.");
  assert.equal(taken.created.length, 0);

  const charged = await offered();
  charged.table("ai_complaint_cases").set(charged.caseId, { ...charged.theCase(), remedy: { ...(charged.theCase().remedy as object), noCharge: false } });
  assert.match(String(await refused(charged)), /Only no-charge return visits are booked here/);

  const failing = await offered();
  failing.deps.createReturnJob = async () => ({ ok: false, error: "The business is closed that day." });
  assert.equal(await refused(failing), "The business is closed that day.");
  assert.equal(failing.theCase().status, "waiting_customer", "nothing changes when the booking fails");
});
