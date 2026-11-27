import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import type { ActionDeps } from "../actions/context";
import { sendTemplateReply } from "../actions/reply";
import { EMAIL_TRIAGE_COLLECTION } from "../collections";
import { clockLabel, dateLabel } from "../hours";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";
import { COMPLAINT_CASES_COLLECTION, isClosed, mapCase, moveCase, setRemedy, type ComplaintCase } from "./cases";
import { checkCompensation, type CompensationVerdict } from "./compensation-check";
import { findReturnSlots, type ReturnSlot } from "./find-return-slots";
import type { ComplaintJob } from "./find-job";
import { getPolicies } from "./policies";
import { returnVisitApplies, type Applies } from "./return-visit-policy";
import { questionForCase } from "./staff-questions";

/**
 * Putting it right (docs/sophie-email-learning-and-auto-reply.md §10.10): the free times that fit
 * the owner's approved return-visit rule, the owner's offer to the customer, and linking the visit
 * once the owner has booked it in the calendar. Nothing here books anything, changes a job's price
 * or moves any money: the offer is an email the owner chose, and a booking is the owner's own, in
 * the normal calendar.
 */

const DAY_MS = 24 * 60 * 60_000;
const UNFINISHED = "The work isn't finished yet";

const localDate = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const slotLabel = (slot: Pick<ReturnSlot, "date" | "startTime" | "endTime">) => `${dateLabel(slot.date)}, ${clockLabel(slot.startTime)} to ${clockLabel(slot.endTime)}`;

export type ReturnVisitPreview = {
  policyText: string | null;
  /** The owner approved the rule, so Sophie may find times by it. */
  policyApproved: boolean;
  applies: Applies | null;
  slots: { date: string; startTime: string; label: string }[];
  /** Why there are no times, in a sentence for the owner. */
  noSlotsReason: string | null;
  noCharge: boolean;
  compensation: { label: string; verdict: CompensationVerdict["verdict"]; proposal: string | null; why: string | null }[];
};

type Loaded = { case: ComplaintCase; job: ComplaintJob | null };

async function load(deps: ActionDeps, businessId: string, caseId: string): Promise<Loaded | null> {
  if (!/^[0-9a-f]{40}$/.test(caseId)) return null;
  const data = (await deps.db.collection(COMPLAINT_CASES_COLLECTION).doc(caseId).get()).data();
  if (!data || data.businessId !== businessId) return null;
  const found = mapCase(caseId, data);
  const jobs = found.customerEmail && found.jobId ? await deps.complaintJobs(businessId, found.customerEmail) : [];
  return { case: found, job: jobs.find((job) => job.id === found.jobId) ?? null };
}

async function weekCount(db: Firestore, businessId: string, now: number): Promise<number> {
  const snap = await db.collection(COMPLAINT_CASES_COLLECTION).where("businessId", "==", businessId).limit(300).get();
  return snap.docs.filter((doc) => {
    const remedy = mapCase(doc.id, doc.data() ?? {}).remedy;
    return remedy?.kind === "return_visit" && remedy.decidedAt > now - 7 * DAY_MS;
  }).length;
}

async function slotsFor(deps: ActionDeps, loaded: Loaded, now: number, limit: number) {
  const { businessId } = loaded.case;
  const policies = await getPolicies(deps.db, businessId);
  const policy = policies.approved;
  if (!policy) return { policies, slots: null as ReturnSlot[] | null, reason: "Approve your return-visit rule in Settings → Sophie first." };
  const staffUid = loaded.job?.staffUid ?? loaded.case.measures?.staffUid ?? null;
  if (!staffUid) return { policies, slots: null, reason: "The job has no technician recorded, so I can't tell who's free." };
  const timeZone = await deps.timeZone(businessId);
  const schedule = await deps.staffSchedule(businessId, staffUid);
  if (!schedule) return { policies, slots: null, reason: "I couldn't read the technician's working hours." };
  const from = localDate(now, timeZone);
  const to = localDate(now + 70 * DAY_MS, timeZone);
  const hours = await deps.businessHours(businessId, from, to);
  if (!hours.startTime || !hours.endTime || !hours.openDays) return { policies, slots: null, reason: "Set your working hours and open days in Settings first." };
  const result = findReturnSlots({
    window: policy.window, now, timeZone, startTime: hours.startTime, endTime: hours.endTime, openDays: hours.openDays,
    closedDates: new Set(hours.closedDates),
    technician: { offDays: schedule.offDays, leaveDates: schedule.leaveDates, busy: await deps.staffBusy(businessId, staffUid, from, to) },
    durationMinutes: loaded.job?.durationMinutes ?? loaded.case.measures?.durationMinutes ?? null,
    limit,
  });
  return {
    policies, policy, slots: result.ok ? result.slots : null,
    reason: result.ok ? null : `No free time that fits your rule for ${loaded.job?.staffName ?? "the technician"}. Book one yourself in the calendar.`,
  };
}

/** The times and checks for one case's card. Writes nothing. */
export async function previewReturnVisit(deps: ActionDeps, input: { businessId: string; caseId: string; ownerConfirmsOurWork: boolean }, now = Date.now()): Promise<ReturnVisitPreview | null> {
  const loaded = await load(deps, input.businessId, input.caseId);
  if (!loaded) return null;
  const found = await slotsFor(deps, loaded, now, 2);
  const question = await questionForCase(deps.db, input.businessId, input.caseId).catch(() => null);
  const timeZone = await deps.timeZone(input.businessId);
  const applies = found.policy
    ? returnVisitApplies(found.policy, {
      type: loaded.case.type,
      jobDate: loaded.case.measures?.jobDate ?? null,
      today: localDate(now, timeZone),
      confirmedOurWork: input.ownerConfirmsOurWork || question?.answer?.choice === UNFINISHED,
      hadReturnVisit: loaded.case.remedy !== null,
      returnVisitsThisWeek: await weekCount(deps.db, input.businessId, now),
    })
    : null;
  const measures = loaded.case.measures;
  const verdicts = found.policies.compensation
    ? checkCompensation(found.policies.compensation, {
      type: loaded.case.type, minutesAfterWindowEnd: measures?.minutesAfterWindowEnd ?? null,
      minutesAfterWindowStart: measures?.minutesAfterWindowStart ?? null, jobStatus: measures?.jobStatus ?? null,
    })
    : [];
  return {
    policyText: found.policies.returnVisitText,
    policyApproved: found.policies.approved !== null,
    applies,
    slots: (found.slots ?? []).map((slot) => ({ date: slot.date, startTime: slot.startTime, label: slotLabel(slot) })),
    noSlotsReason: found.slots ? null : found.reason,
    noCharge: found.policies.approved?.noCharge ?? false,
    compensation: verdicts.map((item) => ({
      label: item.entry.label,
      verdict: item.verdict,
      proposal: item.verdict === "applies" ? item.proposal : null,
      why: item.verdict === "unknown" ? item.why : null,
    })),
  };
}

export type OfferResult = { ok: true; offered: string[] } | { ok: false; status: number; error: string };

/**
 * The owner offers the customer the times they chose. Checked again here: the times must still be
 * ones the rule finds free, the owner must have confirmed it's our work, and only one offer is made.
 * The email is a template that offers a visit and says nothing about price or fault.
 */
export async function offerReturnVisit(
  deps: ActionDeps,
  input: { businessId: string; caseId: string; actorUid: string; chosen: { date: string; startTime: string }[]; ownerConfirmsOurWork: boolean },
  now = Date.now(),
): Promise<OfferResult> {
  const loaded = await load(deps, input.businessId, input.caseId);
  if (!loaded) return { ok: false, status: 404, error: "Case not found." };
  if (isClosed(loaded.case.status)) return { ok: false, status: 409, error: "This case is closed." };
  if (loaded.case.remedy) return { ok: false, status: 409, error: "A return visit was already offered for this case." };
  if (!input.ownerConfirmsOurWork) return { ok: false, status: 409, error: "Confirm it's our work first." };
  if (input.chosen.length < 1 || input.chosen.length > 2) return { ok: false, status: 400, error: "Choose one or two times to offer." };
  const found = await slotsFor(deps, loaded, now, 10);
  if (!found.slots || !found.policy) return { ok: false, status: 409, error: found.reason ?? "No times are free." };
  const picked = input.chosen.map((choice) => found.slots!.find((slot) => slot.date === choice.date && slot.startTime === choice.startTime));
  if (picked.some((slot) => !slot)) return { ok: false, status: 409, error: "One of those times isn't free any more. Look at the times again." };
  const offered = (picked as ReturnSlot[]).map(slotLabel);

  const triage = (await deps.db.collection(EMAIL_TRIAGE_COLLECTION).doc(loaded.case.triageId).get()).data();
  const message = triage ? (await deps.db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(triage.messageId ?? "")).get()).data() : null;
  if (!triage || triage.businessId !== input.businessId || !message || message.businessId !== input.businessId) {
    return { ok: false, status: 409, error: "The customer's email isn't in the mailbox any more. Reply yourself." };
  }
  const sent = await sendTemplateReply({
    deps, businessId: input.businessId, triageId: loaded.case.triageId, triage, message, authority: "owner", actorUid: input.actorUid,
    decision: { offerTimes: offered }, now,
  }, "complaint_return_visit_offer");
  if (sent.status !== "done") return { ok: false, status: 409, error: sent.summary };

  await setRemedy(deps.db, { businessId: input.businessId, caseId: input.caseId, remedy: { kind: "return_visit", noCharge: found.policy.noCharge, offered, offeredSlots: (picked as ReturnSlot[]).map((slot) => ({ date: slot.date, startTime: slot.startTime, endTime: slot.endTime, label: slotLabel(slot) })), revisitJobId: null, decidedBy: input.actorUid } }, now);
  await moveCase(deps.db, { businessId: input.businessId, caseId: input.caseId, to: "waiting_customer", event: `Offered ${offered.join(" or ")}.`, by: input.actorUid }, now);
  return { ok: true, offered };
}

export type BookResult = { ok: true; code: string } | { ok: false; status: number; error: string };

/**
 * The owner taps "Book this time" for the time the customer picked from the offer. Only for a
 * no-charge visit, only a time that was offered, and only if the rule still finds it free. The visit
 * is booked through the platform's own job path, so the customer is told as for any job; Sophie sets
 * no price. A visit that isn't no-charge is booked by the owner in the calendar.
 */
export async function bookReturnVisit(
  deps: ActionDeps,
  input: { businessId: string; caseId: string; date: string; startTime: string; actorUid: string },
  now = Date.now(),
): Promise<BookResult> {
  const loaded = await load(deps, input.businessId, input.caseId);
  if (!loaded) return { ok: false, status: 404, error: "Case not found." };
  const { remedy } = loaded.case;
  if (!remedy || loaded.case.status !== "waiting_customer") return { ok: false, status: 409, error: "Offer the customer times first." };
  if (remedy.revisitJobId) return { ok: false, status: 409, error: "A return visit is already booked for this case." };
  if (!remedy.noCharge) return { ok: false, status: 409, error: "Only no-charge return visits are booked here. Book this one in the calendar, then link it." };
  const chosen = remedy.offeredSlots?.find((slot) => slot.date === input.date && slot.startTime === input.startTime);
  if (!chosen || !loaded.case.jobId) return { ok: false, status: 409, error: "That isn't one of the times you offered." };

  // Free at this moment, by the same rule.
  const found = await slotsFor(deps, loaded, now, 10);
  if (!found.slots?.some((slot) => slot.date === chosen.date && slot.startTime === chosen.startTime)) {
    return { ok: false, status: 409, error: "That time isn't free any more. Book another time in the calendar, then link it." };
  }
  const created = await deps.createReturnJob({
    businessId: input.businessId, originalJobId: loaded.case.jobId, date: chosen.date, startTime: chosen.startTime, endTime: chosen.endTime, actorUid: input.actorUid,
  });
  if (!created.ok) return { ok: false, status: 409, error: created.error };

  await deps.db.collection("jobs").doc(created.jobId).set({ linkedJobId: loaded.case.jobId, returnVisit: true, noCharge: true }, { merge: true });
  await deps.db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId).set({ remedy: { revisitJobId: created.jobId } }, { merge: true });
  const moved = await moveCase(deps.db, { businessId: input.businessId, caseId: input.caseId, to: "revisit_booked", event: `Return visit booked for ${chosen.label}: ${created.code}.`, by: input.actorUid }, now);
  return moved.ok ? { ok: true, code: created.code } : { ok: false, status: moved.status, error: moved.error };
}

export type LinkResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * After the owner books the return visit in the calendar, they link it here: it must be this
 * customer's job, not the original, and not cancelled. The new job is marked as a return visit of
 * the original. Nothing about its price or invoice is touched.
 */
export async function linkReturnVisit(
  deps: ActionDeps,
  input: { businessId: string; caseId: string; jobId: string; actorUid: string },
  now = Date.now(),
): Promise<LinkResult> {
  const loaded = await load(deps, input.businessId, input.caseId);
  if (!loaded) return { ok: false, status: 404, error: "Case not found." };
  if (!loaded.case.jobId || !loaded.case.customerEmail) return { ok: false, status: 409, error: "Link the original job to this case first." };
  if (input.jobId === loaded.case.jobId) return { ok: false, status: 409, error: "That's the original job. Choose the new visit." };
  const jobs = await deps.complaintJobs(input.businessId, loaded.case.customerEmail);
  const visit = jobs.find((job) => job.id === input.jobId);
  if (!visit || visit.status === "cancelled") return { ok: false, status: 404, error: "That visit isn't one of this customer's open jobs." };

  const ref = deps.db.collection("jobs").doc(input.jobId);
  if ((await ref.get()).data()?.businessId !== input.businessId) return { ok: false, status: 404, error: "That visit isn't one of this customer's open jobs." };
  await ref.set({ linkedJobId: loaded.case.jobId, returnVisit: true }, { merge: true });

  const policies = await getPolicies(deps.db, input.businessId);
  if (!loaded.case.remedy) {
    await setRemedy(deps.db, { businessId: input.businessId, caseId: input.caseId, remedy: { kind: "return_visit", noCharge: policies.approved?.noCharge ?? false, offered: [], revisitJobId: input.jobId, decidedBy: input.actorUid } }, now);
  } else {
    await deps.db.collection(COMPLAINT_CASES_COLLECTION).doc(input.caseId).set({ remedy: { revisitJobId: input.jobId } }, { merge: true });
  }
  if (loaded.case.status !== "waiting_customer") {
    await moveCase(deps.db, { businessId: input.businessId, caseId: input.caseId, to: "waiting_customer", event: "A return visit is being arranged.", by: input.actorUid }, now);
  }
  const moved = await moveCase(deps.db, { businessId: input.businessId, caseId: input.caseId, to: "revisit_booked", event: `Return visit booked: ${visit.code}.`, by: input.actorUid }, now);
  return moved.ok ? { ok: true } : { ok: false, status: moved.status, error: moved.error };
}
