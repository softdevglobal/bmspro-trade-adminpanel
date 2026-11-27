import assert from "node:assert/strict";
import test from "node:test";

import { checkCompensation, parseCompensationGuide, type CompensationEntry } from "../lib/ai/email/complaints/compensation-check";
import { latenessMinutes } from "../lib/ai/email/complaints/facts";
import { findReturnSlots, type SlotInput } from "../lib/ai/email/complaints/find-return-slots";
import { describeReturnVisitPolicy, parseReturnVisitPolicy, returnVisitApplies, type ApplyFacts, type ReturnVisitPolicy } from "../lib/ai/email/complaints/return-visit-policy";

/**
 * Step 9c (docs/sophie-email-learning-and-auto-reply.md §10.10): the owner's return-visit rule, the
 * free-spot finder, and the compensation check, which only ever proposes.
 */

const MEL = "Australia/Melbourne";
// Thursday 26 November 2026, 10 am in Melbourne (AEDT, UTC+11).
const at = (hour: number, minute = 0, day = 26, month = 10) => Date.UTC(2026, month, day, hour - 11, minute);

// ---- The rule (§10.10) ----------------------------------------------------------------------

test("the rule is checked, and anything unclear is refused", () => {
  const saturdays = parseReturnVisitPolicy({ window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" }, noCharge: true });
  assert.ok(saturdays.ok);
  assert.deepEqual([saturdays.policy.appliesTo, saturdays.policy.maxJobAgeDays, saturdays.policy.weeklyLimit, saturdays.policy.noCharge], [["work_unfinished", "repeat_fault"], 30, 5, true]);
  assert.equal(parseReturnVisitPolicy({ window: { kind: "saturdays", count: 2, startTime: "12:00", endTime: "08:00" } }).ok, false);
  assert.equal(parseReturnVisitPolicy({ window: { kind: "business_days", days: 0 } }).ok, false);
  assert.equal(parseReturnVisitPolicy({ window: { kind: "weekends" } }).ok, false);
  assert.equal(parseReturnVisitPolicy("Saturdays").ok, false);
  const money = parseReturnVisitPolicy({ window: { kind: "first_free", withinDays: 14 }, appliesTo: ["billing"] });
  assert.deepEqual(money, { ok: false, error: "A return-visit rule can't cover damage, safety, conduct or billing complaints. You decide those yourself." });
  assert.equal(parseReturnVisitPolicy({ window: { kind: "first_free", withinDays: 14 }, appliesTo: ["safety", "work_unfinished"] }).ok, false);
  assert.equal(parseReturnVisitPolicy({ window: { kind: "first_free", withinDays: 14 }, weeklyLimit: 500 }).ok, false);
});

test("the rule is read back in plain words", () => {
  const parsed = parseReturnVisitPolicy({ window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" }, noCharge: true });
  assert.ok(parsed.ok);
  assert.equal(describeReturnVisitPolicy(parsed.policy), "When a verified customer says the work isn't finished or the same fault is back about a job we completed in the last 30 days, offer two free times the next 2 Saturdays, 8 am to 12 pm, at no charge, with the same technician if free. At most 5 return visits a week. You confirm each offer.");
  const days = parseReturnVisitPolicy({ window: { kind: "business_days", days: 2 } });
  assert.ok(days.ok && describeReturnVisitPolicy(days.policy).includes("within 2 business days, charged as usual"));
});

const POLICY: Omit<ReturnVisitPolicy, "version"> = { window: { kind: "business_days", days: 2 }, appliesTo: ["work_unfinished", "repeat_fault"], maxJobAgeDays: 30, noCharge: true, weeklyLimit: 5 };
const FACTS: ApplyFacts = { type: "work_unfinished", jobDate: "2026-11-20" as string | null, today: "2026-11-26", confirmedOurWork: true, hadReturnVisit: false, returnVisitsThisWeek: 0 };

test("the rule applies only inside its conditions", () => {
  assert.deepEqual(returnVisitApplies(POLICY, FACTS), { applies: true });
  const why = (overrides: Partial<ApplyFacts>) => { const result = returnVisitApplies(POLICY, { ...FACTS, ...overrides }); return result.applies ? null : result.reason; };
  assert.match(why({ type: "damage" })!, /doesn't cover/);
  assert.match(why({ type: null })!, /doesn't cover/);
  assert.match(why({ hadReturnVisit: true })!, /already a return visit/);
  assert.match(why({ confirmedOurWork: false })!, /Nobody has confirmed/);
  assert.match(why({ jobDate: "2026-10-01" })!, /more than 30 days/);
  assert.match(why({ jobDate: null })!, /isn't recorded/);
  assert.match(why({ returnVisitsThisWeek: 5 })!, /reached 5 return visits/);
});

// ---- The free-spot finder (§10.10) -----------------------------------------------------------

const BASE: SlotInput = {
  window: { kind: "business_days", days: 3 }, now: at(10), timeZone: MEL, startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5, 6],
  closedDates: new Set(), technician: { offDays: ["sunday"], leaveDates: new Set(), busy: [] }, durationMinutes: 60,
};
const labels = (result: ReturnType<typeof findReturnSlots>) => (result.ok ? result.slots.map((slot) => `${slot.date} ${slot.startTime}`) : result.reason);

test("business days: the two earliest times, one a day, not sooner than two hours away", () => {
  assert.deepEqual(labels(findReturnSlots(BASE)), ["2026-11-26 12:00", "2026-11-27 08:00"], "Thursday 10 am: 12 pm is the first time at least 2 hours out");
  assert.deepEqual(labels(findReturnSlots({ ...BASE, now: at(16) })), ["2026-11-27 08:00", "2026-11-28 08:00"]);
});

test("Saturdays: only the rule's hours, on the next Saturdays", () => {
  const result = findReturnSlots({ ...BASE, window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" } });
  assert.deepEqual(labels(result), ["2026-11-28 08:00", "2026-12-05 08:00"]);
  assert.deepEqual(labels(findReturnSlots({ ...BASE, window: { kind: "saturdays", count: 2, startTime: "10:00", endTime: "11:00" }, durationMinutes: 90 })), "nothing_free", "a 90 minute visit doesn't fit in an hour");
  assert.deepEqual(labels(findReturnSlots({ ...BASE, window: { kind: "saturdays", count: 2, startTime: "08:00", endTime: "12:00" }, openDays: [1, 2, 3, 4, 5] })), "nothing_free", "the business isn't open Saturdays");
});

test("closures, leave, off days and booked times are all avoided", () => {
  assert.deepEqual(labels(findReturnSlots({ ...BASE, closedDates: new Set(["2026-11-26", "2026-11-27"]) })), ["2026-11-28 08:00", "2026-11-30 08:00"], "closed days are skipped, and the 3 business days move on");
  assert.deepEqual(labels(findReturnSlots({ ...BASE, technician: { ...BASE.technician, leaveDates: new Set(["2026-11-26"]) } })), ["2026-11-27 08:00", "2026-11-28 08:00"]);
  assert.deepEqual(labels(findReturnSlots({ ...BASE, technician: { ...BASE.technician, offDays: ["sunday", "friday"] } })), ["2026-11-26 12:00", "2026-11-28 08:00"]);
  const busy = [{ start: at(8, 0, 27), end: at(12, 30, 27) }, { start: at(12, 0), end: at(13, 30) }];
  assert.deepEqual(labels(findReturnSlots({ ...BASE, technician: { ...BASE.technician, busy } })), ["2026-11-26 13:30", "2026-11-27 12:30"], "the first gap that fits");
});

test("nothing free, bad hours, and a day that the clocks change", () => {
  const allBusy = [{ start: at(0, 0, 26), end: at(23, 59, 30) }];
  assert.deepEqual(labels(findReturnSlots({ ...BASE, technician: { ...BASE.technician, busy: allBusy } })), "nothing_free");
  assert.deepEqual(labels(findReturnSlots({ ...BASE, startTime: "17:00", endTime: "08:00" })), "bad_hours");
  // DST ends in Melbourne on Sunday 5 April 2026 at 3 am: Saturday 4 April 8 am is still +11, Monday 6 April is +10.
  const dst = findReturnSlots({ ...BASE, now: Date.UTC(2026, 3, 1, 0, 0), window: { kind: "business_days", days: 6 }, limit: 10 });
  assert.ok(dst.ok);
  const monday = dst.slots.find((slot) => slot.date === "2026-04-06");
  assert.equal(monday?.start, Date.UTC(2026, 3, 5, 22, 0), "8 am on Monday 6 April after the change is 22:00 UTC the day before");
  const saturday = dst.slots.find((slot) => slot.date === "2026-04-04");
  assert.equal(saturday?.start, Date.UTC(2026, 3, 3, 21, 0), "8 am on Saturday before the change is 21:00 UTC the day before");
});

// ---- The compensation check (§10.10) ---------------------------------------------------------

const GUIDE: { entries: CompensationEntry[] } = {
  entries: [
    { label: "More than an hour late: $30 off", when: { kind: "late_over_minutes", minutes: 60 }, proposal: { kind: "discount", amountAud: 30 } },
    { label: "Missed visit: waive the call-out fee", when: { kind: "missed_visit" }, proposal: { kind: "waive_call_out_fee" } },
  ],
};

test("the guide is checked line by line: applies, doesn't, or unknown, and never writes anything", () => {
  const late = checkCompensation(GUIDE, { type: "late_arrival", minutesAfterWindowEnd: 72, minutesAfterWindowStart: 192, jobStatus: "completed" });
  assert.deepEqual(late.map((item) => item.verdict), ["applies", "doesnt_apply"]);
  assert.equal(late[0].verdict === "applies" && late[0].proposal, "take $30.00 off");
  const inside = checkCompensation(GUIDE, { type: "late_arrival", minutesAfterWindowEnd: -30, minutesAfterWindowStart: 90, jobStatus: "completed" });
  assert.equal(inside[0].verdict, "doesnt_apply", "started inside the booked window isn't late");
  const unknown = checkCompensation(GUIDE, { type: "late_arrival", minutesAfterWindowEnd: null, minutesAfterWindowStart: null, jobStatus: "completed" });
  assert.deepEqual([unknown[0].verdict, unknown[0].verdict === "unknown" && unknown[0].why], ["unknown", "When the visit started isn't recorded."]);
  const missed = checkCompensation(GUIDE, { type: "missed_visit", minutesAfterWindowEnd: null, minutesAfterWindowStart: null, jobStatus: "missed" });
  assert.deepEqual(missed.map((item) => item.verdict), ["unknown", "applies"]);
  assert.equal(missed[1].verdict === "applies" && missed[1].proposal, "waive the call-out fee");
});

test("a guide is checked: 1 to 5 lines, real amounts, nothing that moves money by itself", () => {
  const ok = parseCompensationGuide([{ label: "Over an hour late", when: { kind: "late_over_minutes", minutes: 60 }, proposal: { kind: "discount", amountAud: 30 } }]);
  assert.ok(ok.ok && ok.entries.length === 1);
  for (const bad of [
    [], "refund everyone", Array(6).fill(ok.ok ? ok.entries[0] : null),
    [{ label: "x", when: { kind: "missed_visit" }, proposal: { kind: "waive_call_out_fee" } }],
    [{ label: "Too much", when: { kind: "missed_visit" }, proposal: { kind: "discount", amountAud: 50_000 } }],
    [{ label: "Odd cents", when: { kind: "missed_visit" }, proposal: { kind: "discount", amountAud: 10.005 } }],
    [{ label: "Refund it", when: { kind: "missed_visit" }, proposal: { kind: "refund_all" } }],
    [{ label: "Anytime", when: { kind: "always" }, proposal: { kind: "discount", amountAud: 5 } }],
  ]) assert.equal(parseCompensationGuide(bad).ok, false, JSON.stringify(bad).slice(0, 60));
});

test("lateness is measured against the booked window", () => {
  const job = { date: "2026-11-24", startTime: "09:00", endTime: "11:00", visitStartedAt: at(12, 2, 24) };
  assert.deepEqual(latenessMinutes(job, MEL), { afterStart: 182, afterEnd: 62 });
  assert.equal(latenessMinutes({ ...job, visitStartedAt: null }, MEL), null);
});
