import { jobBookingArguments, jobCancelArguments, jobLookupArguments, jobRescheduleArguments, voiceCustomerMatches,
  type VoiceActionResult, type VoiceJobSlot, type ScheduleVoiceTask } from "./action-schemas";
import { parseInspectionRequestInput, parseSlotsArray, type InspectionCustomer, type InspectionAddress, type InspectionRequestDetail } from "@/lib/inspection/types";
import type { BookingDetail } from "@/lib/bookings/types";
import type { AiJobVisitPlan } from "@/lib/team/ai-assignment-server";
import { runVoiceOperation, voiceOperationStore } from "./operation";
import type { VoiceBusiness } from "../../config";
import type { Transaction } from "firebase-admin/firestore";

type PlannedVisit = Extract<AiJobVisitPlan, { ok: true }>;
type JobInput = { serviceId: string; durationMinutes: number; customer: InspectionCustomer; customerId: string | null; address: InspectionAddress; customerNotes: string };
type JobWrite = { ok: true; booking: BookingDetail; reassigned?: boolean } | { ok: false; error: string; planChanged?: boolean };
export type JobEvent = { kind: "booked" | "rescheduled" | "cancelled"; booking: BookingDetail; reason?: string };
export interface VoiceJobDependencies {
  business(): Promise<Record<string, unknown>>;
  /** Active service owned by this business, with its default visit length. */
  service(id: string): Promise<{ name: string; durationMinutes: number } | null>;
  customer(id: string): Promise<Record<string, unknown> | undefined>;
  findJob(jobCode: string): Promise<BookingDetail | null>;
  plan(input: { serviceId: string; slot: VoiceJobSlot; durationMinutes: number; excludeJobId?: string; staffUids?: string[] }): Promise<AiJobVisitPlan>;
  capacityFull(date: string, startTime: string, endTime: string, excludeJobId?: string): Promise<boolean>;
  create(input: JobInput, plan: PlannedVisit): Promise<JobWrite>;
  /** Saves the job for the owner to schedule (accepted quote awaiting a job) when Sophie cannot confirm it. */
  createPending(input: JobInput & { preferredSlots: VoiceJobSlot[]; reason: string }): Promise<{ ok: true; request: InspectionRequestDetail } | { ok: false; error: string }>;
  requested(request: InspectionRequestDetail, reason: string): void;
  /** Trade's staff automation switch, shared with inspections. */
  autoConfirmEnabled(): boolean;
  /** Moves the job only if the same plan still holds inside the write transaction. */
  move(job: BookingDetail, plan: PlannedVisit): Promise<JobWrite>;
  cancel(job: BookingDetail): Promise<JobWrite>;
  writesEnabled(): boolean;
  once(operation: string, key: string, details: unknown, send: () => Promise<VoiceActionResult>): Promise<VoiceActionResult>;
  done(event: JobEvent): void;
  now?(): Date;
}

const timezoneOf = (business: Record<string, unknown>) => typeof business.timezone === "string" && business.timezone ? business.timezone : "Australia/Melbourne";
const notFound = (): VoiceActionResult => ({ status: "NOT_FOUND", message: "No job matches that reference with those contact details. This does not verify the caller; do not reveal whether the reference exists." });
const teamOnly = (message: string): VoiceActionResult => ({ status: "REJECTED", code: "TEAM_ACTION_REQUIRED", message });
const noAuthority = (): VoiceActionResult => ({ status: "REJECTED", code: "JOB_AUTHORITY_REQUIRED",
  message: "This business has not allowed Sophie to change jobs. Say the team will need to help. Never claim a job was changed." });

function todayIn(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Reference plus both contacts is the minimum to discuss a job; it is still not proof of identity. */
function jobMatches(job: BookingDetail, contact: { email: string; phone: string }) {
  return job.customer.email.trim().toLowerCase() === contact.email && job.customer.phone.replace(/\D/g, "") === contact.phone;
}

/** Sophie only changes simple future visits; anything started, repeating or multi-day stays with the team. */
function changeBlocker(job: BookingDetail, today: string): string | null {
  if (job.status !== "scheduled") return job.status === "ongoing" ? "This job has already started." : `This job is ${job.status}.`;
  if (job.seriesId) return "This is part of a repeating job series.";
  if (job.additionalJobDays.length) return "This job runs over several days.";
  if (job.requestType !== "existing_service" || !job.serviceId) return "This job was arranged from a custom quote.";
  if (!job.scheduledSlot?.date || job.scheduledSlot.date <= today) return "This job is today or already past.";
  return null;
}

function jobSummary(job: BookingDetail, timezone: string, canChange: boolean): NonNullable<VoiceActionResult["job"]> {
  return { jobCode: job.bookingCode ?? "", status: job.status, serviceName: job.serviceName, date: job.scheduledSlot?.date ?? null,
    startTime: job.scheduledStartTime, endTime: job.scheduledEndTime, timezone, suburb: job.address.suburb || null, canChange,
    ...(job.assignedTo?.type === "staff" && job.assignedTo.name ? { staffName: job.assignedTo.name } : {}) };
}

function appointment(job: BookingDetail, timezone: string): VoiceActionResult["appointment"] {
  return { date: job.scheduledSlot?.date ?? "", session: job.scheduledSlot?.timeRange ?? "", startTime: job.scheduledStartTime,
    endTime: job.scheduledEndTime, timezone, ...(job.assignedTo?.type === "staff" && job.assignedTo.name ? { inspectorName: job.assignedTo.name } : {}) };
}

/** Try each preferred session in the caller's order: plan staff and an exact time, then respect hourly job capacity. */
async function planFirstFree(deps: VoiceJobDependencies, serviceId: string, slots: VoiceJobSlot[], durationMinutes: number,
  write: (plan: PlannedVisit) => Promise<JobWrite>, options: { excludeJobId?: string; staffOrder?: Array<string[] | undefined> } = {}) {
  for (const slot of slots) {
    for (const staffUids of options.staffOrder ?? [undefined]) {
      const plan = await deps.plan({ serviceId, slot, durationMinutes, excludeJobId: options.excludeJobId, staffUids });
      if (!plan.ok || await deps.capacityFull(plan.slot.date, plan.startTime, plan.endTime, options.excludeJobId)) continue;
      const result = await write(plan);
      if (result.ok || !result.planChanged) return result;
    }
  }
  return null;
}

export function jobActions(binding: VoiceBusiness, deps: VoiceJobDependencies) {
  const now = () => deps.now?.() ?? new Date();
  const authorised = (business: Record<string, unknown>) => business.sophieJobAuthority === true;
  const futureSlots = (raw: VoiceJobSlot[], timezone: string) => {
    const parsed = parseSlotsArray(raw, 3, timezone);
    if (parsed.length !== raw.length) return null;
    return parsed.map(slot => ({ date: slot.date, timeRange: slot.timeRange, startTime: slot.startTime ?? null }));
  };
  /** Shared verification for lookup, move and cancel: reference + both contacts within this business only. */
  const locate = async (jobCode: string, contact: { email: string; phone: string }) => {
    const job = await deps.findJob(jobCode);
    return job && job.businessId === binding.businessId && jobMatches(job, contact) ? job : null;
  };
  return {
    lookup: async (raw: unknown): Promise<VoiceActionResult> => {
      const args = jobLookupArguments.safeParse(raw);
      if (!args.success) return { status: "REJECTED", message: "Ask for the job reference from the booking message, plus the email and mobile on the job." };
      const business = await deps.business(), timezone = timezoneOf(business);
      const job = await locate(args.data.jobCode, args.data);
      if (!job) return notFound();
      const canChange = authorised(business) && deps.writesEnabled() && changeBlocker(job, todayIn(timezone, now())) === null;
      return { status: "MATCHED", jobCode: job.bookingCode ?? args.data.jobCode, job: jobSummary(job, timezone, canChange),
        message: canChange ? "Share only the returned status, service, date, time and staff name. Sophie may move or cancel this job if the caller asks."
          : "Share only the returned status, service, date, time and staff name. Changes to this job must go through the team." };
    },
    create: async (raw: unknown): Promise<VoiceActionResult> => {
      if (!deps.writesEnabled()) return { status: "REJECTED", message: "Job booking is disabled." };
      const args = jobBookingArguments.safeParse(raw);
      if (!args.success) return { status: "REJECTED", message: "Check the service, site address, preferred times and contacts, then obtain explicit confirmation after reading them back." };
      const business = await deps.business();
      const autoConfirm = deps.autoConfirmEnabled() && authorised(business);
      const timezone = timezoneOf(business);
      const { requestKey, serviceId, customerId, customer, address, preferredSlots, customerNotes } = args.data;
      const details = { serviceId, customerId, customer, address, preferredSlots, customerNotes };
      return deps.once("create_job_booking", requestKey, details, async () => {
        const parsed = parseInspectionRequestInput({ requestType: "existing_service", serviceId, customer, address, preferredSlots, customerNotes }, timezone);
        if (!parsed.ok) return { status: "REJECTED", message: parsed.error };
        const slots = futureSlots(preferredSlots, timezone);
        if (!slots) return { status: "REJECTED", message: "Choose valid future preferred sessions in the business timezone." };
        const service = await deps.service(serviceId);
        if (!service) return { status: "REJECTED", message: "Choose an active service for this business." };
        if (customerId && !voiceCustomerMatches(await deps.customer(customerId), binding.businessId, customer)) {
          return { status: "REJECTED", code: "CUSTOMER_VERIFICATION_REQUIRED", message: "The customer reference does not match this business and the supplied contacts. Staff must verify it." };
        }
        const input = { serviceId, durationMinutes: service.durationMinutes, customer: parsed.value.customer, customerId,
          address: parsed.value.address, customerNotes: parsed.value.customerNotes ?? "" };
        const result = autoConfirm ? await planFirstFree(deps, serviceId, slots, service.durationMinutes, plan => deps.create(input, plan)) : null;
        if (result && !result.ok) return { status: "REJECTED", message: result.error };
        if (!result) {
          // Same as inspections: anything Sophie cannot confirm waits for the owner instead of being turned away.
          const reason = autoConfirm ? "No qualified staff member was free for the full job at the caller's preferred times."
            : "Sophie is not authorised to confirm jobs for this business.";
          const pending = await deps.createPending({ ...input, preferredSlots: slots, reason });
          if (!pending.ok) return { status: "REJECTED", message: pending.error };
          deps.requested(pending.request, reason);
          return { status: "PENDING_REVIEW", requestId: pending.request.id, code: autoConfirm ? "STAFF_ASSIGNMENT_REVIEW_REQUIRED" : "JOB_REVIEW_REQUIRED",
            message: autoConfirm ? "The job request was saved, but no qualified staff member is free for the whole job at those times. The team will confirm the time; do not say it is booked."
              : "The job request was received with the caller's preferred times. The team will confirm the time and staff member; do not say it is booked." };
        }
        deps.done({ kind: "booked", booking: result.booking });
        return { status: "CONFIRMED", jobCode: result.booking.bookingCode ?? undefined, appointment: appointment(result.booking, timezone),
          message: "The job is booked. Tell the caller the returned date, start time and staff name, and the job reference for future changes. Other preferred times were alternatives, not extra visits. Do not quote a price." };
      });
    },
    reschedule: async (raw: unknown): Promise<VoiceActionResult> => {
      if (!deps.writesEnabled()) return { status: "REJECTED", message: "Job changes are disabled." };
      const args = jobRescheduleArguments.safeParse(raw);
      if (!args.success) return { status: "REJECTED", message: "Confirm the job reference, contacts and new preferred times, then obtain explicit confirmation." };
      const business = await deps.business();
      if (!authorised(business) || !deps.autoConfirmEnabled()) return noAuthority();
      const timezone = timezoneOf(business);
      const { requestKey, jobCode, email, phone, preferredSlots } = args.data;
      return deps.once("reschedule_job", requestKey, { jobCode, email, phone, preferredSlots }, async () => {
        const job = await locate(jobCode, { email, phone });
        if (!job) return notFound();
        const blocker = changeBlocker(job, todayIn(timezone, now()));
        if (blocker) return teamOnly(`${blocker} Sophie cannot move it; the team must help.`);
        const slots = futureSlots(preferredSlots, timezone);
        if (!slots) return { status: "REJECTED", message: "Choose valid future preferred sessions in the business timezone." };
        const service = await deps.service(job.serviceId!);
        if (!service) return teamOnly("The job's service is no longer active. The team must help.");
        const current = job.assignedTo?.type === "staff" ? job.assignedTo.uid : null;
        const result = await planFirstFree(deps, job.serviceId!, slots, job.estimatedDurationMinutes || service.durationMinutes,
          plan => deps.move(job, plan), { excludeJobId: job.id, staffOrder: current ? [[current], undefined] : [undefined] });
        if (!result) return { status: "REJECTED", code: "NO_AVAILABLE_TIME", message: "No qualified staff member is free for the full job at those times. The job keeps its original time; offer other dates or times." };
        if (!result.ok) return { status: "REJECTED", message: result.error };
        deps.done({ kind: "rescheduled", booking: result.booking });
        return { status: "CONFIRMED", jobCode: result.booking.bookingCode ?? jobCode, appointment: appointment(result.booking, timezone),
          message: "The job has moved. Tell the caller the returned new date, start time and staff name. The old time is released." };
      });
    },
    cancel: async (raw: unknown): Promise<VoiceActionResult> => {
      if (!deps.writesEnabled()) return { status: "REJECTED", message: "Job changes are disabled." };
      const args = jobCancelArguments.safeParse(raw);
      if (!args.success) return { status: "REJECTED", message: "Confirm the job reference and contacts, read back the job, and obtain explicit confirmation to cancel it." };
      const business = await deps.business();
      if (!authorised(business)) return noAuthority();
      const timezone = timezoneOf(business);
      const { requestKey, jobCode, email, phone, reason } = args.data;
      return deps.once("cancel_job", requestKey, { jobCode, email, phone, reason }, async () => {
        const job = await locate(jobCode, { email, phone });
        if (!job) return notFound();
        const blocker = changeBlocker(job, todayIn(timezone, now()));
        if (blocker) return teamOnly(`${blocker} Sophie cannot cancel it; the team must help.`);
        const result = await deps.cancel(job);
        if (!result.ok) return { status: "REJECTED", message: result.error };
        deps.done({ kind: "cancelled", booking: result.booking, reason });
        return { status: "CANCELLED", jobCode: result.booking.bookingCode ?? jobCode,
          message: "The job is cancelled. Confirm this briefly. Do not promise a refund, fee waiver or follow-up call." };
      });
    },
  };
}

class PlanChangedError extends Error {}

export async function createVoiceJobTools(binding: VoiceBusiness, business: VoiceJobDependencies["business"], schedule: ScheduleVoiceTask) {
  const [{ adminDb, adminAuth }, assignment, bookings, occupancy, { mapBookingDoc }] = await Promise.all([
    import("@/lib/firebase/admin"), import("@/lib/team/ai-assignment-server"), import("@/lib/bookings/server"),
    import("@/lib/calendar/slot-occupancy"), import("@/lib/bookings/map-booking-doc"),
  ]);
  const sophie = { uid: null, role: "call_center" as const, name: "Sophie (voice)", email: null };
  /** Re-plan for exactly the chosen staff member and start time; anything else means another booking got there first. */
  const recheck = async (tx: Transaction, serviceId: string, plan: PlannedVisit, excludeJobId?: string) => {
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const durationMinutes = minutes(plan.endTime) - minutes(plan.startTime);
    const again = await assignment.planAiJobVisitInTransaction(adminDb, tx, { businessId: binding.businessId, serviceId, durationMinutes, excludeJobId,
      staffUids: [plan.assignedTo.uid], slots: [{ ...plan.slot, startTime: plan.startTime }] });
    if (!again.ok || again.startTime !== plan.startTime || again.endTime !== plan.endTime) throw new PlanChangedError();
  };
  return jobActions(binding, {
    business, writesEnabled: () => process.env.AI_VOICE_ACTIONS_ENABLED === "true",
    autoConfirmEnabled: () => process.env.AI_AUTO_ASSIGN_STAFF_ENABLED === "true",
    service: async id => {
      const data = (await adminDb.collection("services").doc(id).get()).data();
      if (data?.businessId !== binding.businessId || data?.isActive !== true) return null;
      const minutes = typeof data.defaultDurationMin === "number" && data.defaultDurationMin > 0 ? Math.round(data.defaultDurationMin) : 60;
      return { name: String(data.name ?? "Service"), durationMinutes: Math.min(minutes, 540) };
    },
    customer: async id => {
      const data = (await adminDb.collection("customers").doc(id).get()).data();
      if (!data || data.registeredBusinessId !== binding.businessId) return undefined;
      try { return (await adminAuth.getUser(id)).disabled ? undefined : data; } catch { return undefined; }
    },
    findJob: async jobCode => {
      const snapshot = await adminDb.collection("jobs").where("businessId", "==", binding.businessId).where("bookingCode", "==", jobCode).limit(2).get();
      return snapshot.docs.length === 1 ? mapBookingDoc(snapshot.docs[0].id, snapshot.docs[0].data()) : null;
    },
    plan: ({ serviceId, slot, durationMinutes, excludeJobId, staffUids }) => adminDb.runTransaction(tx => assignment.planAiJobVisitInTransaction(adminDb, tx,
      { businessId: binding.businessId, serviceId, slots: [slot], durationMinutes, excludeJobId, staffUids })),
    capacityFull: async (date, startTime, endTime, excludeJobId) => {
      const day = await occupancy.computeDaySlotOccupancy(binding.businessId, date, excludeJobId ? { excludeBookingId: excludeJobId } : undefined);
      return occupancy.rangeOverlapsFullSlots(day.slots, startTime, endTime, "job");
    },
    create: async (input, plan) => {
      try {
        const result = await bookings.createDirectJob(binding.businessId, "sophie", {
          requestType: "existing_service", serviceId: input.serviceId, customRequest: null, customer: input.customer, address: input.address,
          customerNotes: input.customerNotes || null, budgetAud: null, slot: { ...plan.slot, startTime: plan.startTime, endTime: plan.endTime },
          startTime: plan.startTime, endTime: plan.endTime, estimatedDurationMinutes: input.durationMinutes, assignedTo: plan.assignedTo,
          skipCustomerAccount: true, customerId: input.customerId,
          verifyInTransaction: tx => recheck(tx, input.serviceId, plan),
        }, { actor: sophie, source: "system" });
        return result.ok ? { ok: true, booking: result.booking } : { ok: false, error: result.error };
      } catch (error) {
        if (error instanceof PlanChangedError) return { ok: false, error: "That time was just taken.", planChanged: true };
        throw error;
      }
    },
    move: async (job, plan) => {
      const ref = adminDb.collection("jobs").doc(job.id);
      try {
        await adminDb.runTransaction(async tx => {
          const current = mapBookingDoc(job.id, (await tx.get(ref)).data() ?? {});
          // Reject if anyone changed the visit since the caller's lookup.
          if (current.businessId !== binding.businessId || current.status !== "scheduled" || current.scheduledSlot?.date !== job.scheduledSlot?.date ||
              current.scheduledStartTime !== job.scheduledStartTime || current.assignedTo?.uid !== job.assignedTo?.uid) throw new PlanChangedError();
          await recheck(tx, job.serviceId!, plan, job.id);
          tx.update(ref, { scheduledSlot: plan.slot, scheduledStartTime: plan.startTime, scheduledEndTime: plan.endTime, assignedTo: plan.assignedTo,
            sophieRescheduledAt: new Date(), updatedAt: new Date() });
        });
      } catch (error) {
        if (error instanceof PlanChangedError) return { ok: false, error: "That time was just taken.", planChanged: true };
        throw error;
      }
      const reassigned = plan.assignedTo.uid !== job.assignedTo?.uid;
      const booking = await bookings.finishAiJobReschedule(binding.businessId, job.id, reassigned);
      return booking ? { ok: true, booking, reassigned } : { ok: false, error: "The job could not be reloaded. Staff must check it." };
    },
    createPending: async ({ serviceId, customer, customerId, address, customerNotes, preferredSlots, reason }) => bookings.createPendingJobRequest(binding.businessId, {
      serviceId, customer, customerId, address, customerNotes: customerNotes || null, reason,
      preferredSlots: preferredSlots.map(slot => ({ date: slot.date, timeRange: slot.timeRange, ...(slot.startTime ? { startTime: slot.startTime } : {}) })),
    }),
    requested: (request, reason) => {
      schedule("job-request-audit", async () => {
        const { logAuditEvent } = await import("@/lib/audit/server");
        await logAuditEvent({ businessId: binding.businessId, category: "inspection", action: "inspection.created", actor: sophie, source: "system",
          summary: `Job request ${request.requestCode || request.id} saved by Sophie for scheduling: ${reason}`, targetId: request.id, targetLabel: request.serviceName });
      });
      schedule("sophie-job-request-alert", async () => {
        const { sendSophieInspectionOwnerAlert } = await import("@/lib/notifications/sophie-owner-alert");
        const first = request.jobPreferredSlots[0];
        await sendSophieInspectionOwnerAlert({ businessId: binding.businessId, requestCode: request.requestCode || request.id, customerName: request.customer.fullName,
          serviceName: request.serviceName || "Job", status: "pending", title: "Sophie created a job request",
          reviewNote: "Open it in Site inspections and choose Create job to schedule it.", date: first?.date, timeRange: first?.timeRange, startTime: first?.startTime ?? null });
      });
    },
    cancel: async job => {
      const result = await bookings.cancelBusinessBooking(binding.businessId, job.id);
      return result.ok ? { ok: true, booking: result.booking } : { ok: false, error: result.error };
    },
    once: async (operation, key, details, send) => runVoiceOperation(await voiceOperationStore(binding.businessId, binding.did, operation), binding.businessId, operation, key, details, send),
    done: ({ kind, booking, reason }) => {
      const code = booking.bookingCode || booking.id;
      const staffName = booking.assignedTo?.type === "staff" ? booking.assignedTo.name : null;
      // createDirectJob already writes its own booking.created audit entry.
      if (kind !== "booked") schedule(`job-${kind}-audit`, async () => {
        const { logAuditEvent } = await import("@/lib/audit/server");
        await logAuditEvent({ businessId: binding.businessId, category: "booking", action: kind === "cancelled" ? "booking.cancelled" : "booking.rescheduled",
          actor: sophie, source: "system", summary: kind === "cancelled" ? `Job ${code} cancelled by Sophie at the caller's request${reason ? `: ${reason}` : ""}.`
            : `Job ${code} rescheduled by Sophie to ${booking.scheduledSlot?.date} ${booking.scheduledStartTime}–${booking.scheduledEndTime}.`,
          targetId: booking.id, targetLabel: booking.bookingCode ?? null });
      });
      schedule(`sophie-job-${kind}-alert`, async () => {
        const { sendSophieInspectionOwnerAlert } = await import("@/lib/notifications/sophie-owner-alert");
        await sendSophieInspectionOwnerAlert({ businessId: binding.businessId, requestCode: code, customerName: booking.customer.fullName,
          serviceName: booking.serviceName || "Job", status: kind === "cancelled" ? "pending" : "scheduled",
          title: kind === "booked" ? "Sophie booked a job" : kind === "rescheduled" ? "Sophie rescheduled a job" : "Sophie cancelled a job",
          reviewNote: reason ? `Reason: ${reason}` : "No action needed unless you want to follow up.",
          date: booking.scheduledSlot?.date, timeRange: booking.scheduledSlot?.timeRange, startTime: booking.scheduledStartTime,
          endTime: booking.scheduledEndTime, staffName });
      });
    },
  });
}
