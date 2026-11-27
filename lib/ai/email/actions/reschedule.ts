import { findReturnSlots } from "../complaints/find-return-slots";
import { clockLabel, dateLabel } from "../hours";
import type { ActionContext, ActionHandler } from "./context";

/**
 * "Can we move Thursday's visit to Friday?" (docs/sophie-email-learning-and-auto-reply.md §9.1).
 * For a verified customer with exactly one open booking, Sophie finds the first free times for the
 * same technician (looking 14 days ahead, by the same rules as a return visit) and tells the owner.
 * She changes NOTHING on the job: the owner moves it in the calendar, and the customer is told by
 * the owner or by the "we've received your request" reply, which agrees to no time.
 *
 * Never done by a rule: it is a suggestion, and every customer's change is the owner's call.
 */

const VERIFIED = new Set(["verified_sender", "verified_thread"]);
const OPEN = new Set(["scheduled", "awaiting"]);

const localDate = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

/** The customer's one open booking, or why not. Shared with the acknowledgement's booking reference. */
export async function theOpenBooking(context: Pick<ActionContext, "deps" | "businessId" | "triage" | "message">) {
  const { deps, businessId, triage, message } = context;
  if (!VERIFIED.has(String(triage.identity)) || triage.hasOtherRecipients !== false) return { ok: false as const, why: "They aren't a verified customer writing on their own, so I left it to you." };
  const email = typeof message?.fromAddress === "string" ? message.fromAddress.trim().toLowerCase() : "";
  if (!email) return { ok: false as const, why: "I couldn't tell who wrote." };
  const open = (await deps.complaintJobs(businessId, email)).filter((job) => OPEN.has(job.status));
  if (open.length !== 1) return { ok: false as const, why: open.length === 0 ? "They have no open booking." : "They have more than one open booking, so I can't tell which one they mean." };
  return { ok: true as const, job: open[0], email };
}

export const proposeReschedule: ActionHandler = {
  async run(context) {
    const { deps, businessId, now } = context;
    if (!context.message) return { status: "skipped", summary: "The email is no longer in the mailbox." };
    const found = await theOpenBooking(context);
    if (!found.ok) return { status: "manual", summary: `I didn't look for times: ${found.why}` };
    const { job } = found;
    if (!job.staffUid) return { status: "manual", summary: `I didn't look for times: ${job.code} has no technician recorded.` };

    const timeZone = await deps.timeZone(businessId);
    const schedule = await deps.staffSchedule(businessId, job.staffUid);
    const from = localDate(now, timeZone);
    const to = localDate(now + 21 * 24 * 60 * 60_000, timeZone);
    const hours = await deps.businessHours(businessId, from, to);
    if (!schedule || !hours.startTime || !hours.endTime || !hours.openDays) {
      return { status: "manual", summary: "I didn't look for times: set your working hours and open days in Settings first." };
    }
    const result = findReturnSlots({
      window: { kind: "first_free", withinDays: 14 }, now, timeZone, startTime: hours.startTime, endTime: hours.endTime, openDays: hours.openDays,
      closedDates: new Set(hours.closedDates),
      technician: { offDays: schedule.offDays, leaveDates: schedule.leaveDates, busy: await deps.staffBusy(businessId, job.staffUid, from, to) },
      durationMinutes: job.durationMinutes, limit: 3,
    });
    const times = result.ok ? result.slots.map((slot) => `${dateLabel(slot.date)}, ${clockLabel(slot.startTime)} to ${clockLabel(slot.endTime)}`) : [];
    const booked = job.date ? dateLabel(job.date) : "its current date";
    const summary = times.length > 0
      ? `They want to change ${job.code} (booked ${booked}). ${job.staffName ?? "The technician"} is free: ${times.join("; ")}. Change it in the calendar, then tell them. I've changed nothing.`
      : `They want to change ${job.code} (booked ${booked}), but ${job.staffName ?? "the technician"} has nothing free in the next 14 days. I've changed nothing.`;
    await deps.pushOwner(businessId, {
      title: "A customer wants to change a booking",
      body: summary.slice(0, 200),
      data: { type: "email_reschedule", link: "/dashboard/emails?tab=sophie", triageId: context.triageId },
    }).catch((error) => console.error("[email/reschedule] push failed", (error as Error)?.name));
    return { status: "done", summary };
  },
};
