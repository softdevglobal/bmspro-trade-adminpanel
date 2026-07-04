import "server-only";

import {
  computeDaySlotOccupancy,
  rangeOverlapsFullSlots,
} from "@/lib/calendar/slot-occupancy";
import { isBusinessClosedOnDate } from "@/lib/calendar/business-closures/server";
import type { CalendarScheduleInput } from "@/lib/calendar/schedule-input";
import {
  customerOwnsRequestRecord,
  type CustomerOwnershipIdentity,
} from "@/lib/customer/ownership";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import {
  mapInspectionDoc,
  sortInspectionRequestsNewestFirst,
} from "@/lib/inspection/map-inspection-doc";
import { getRequestDocument } from "@/lib/inspection/request-document";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import {
  InspectionAssignment,
  InspectionRequestCreatedSource,
  InspectionRequestDetail,
  InspectionRequestInput,
  InspectionRequestStatus,
  InspectionSlot,
  timeRangeFromStartTime,
} from "@/lib/inspection/types";
import {
  notifyBusinessOfCustomerAcceptance,
  notifyBusinessOfNewRequest,
  notifyCustomerOfAssignment,
  notifyCustomerOfNewRequest,
  notifyCustomerOfJobScheduled,
  notifyCustomerOfRequestRescheduled,
  notifyCustomerOfStatusChange,
  notifyCustomerOfVisitOnTheWay,
} from "@/lib/notifications/server";
import { sendStaffMobilePush } from "@/lib/notifications/push";
import {
  createBookingFromInspection,
  mirrorBookingToQuotations,
} from "@/lib/bookings/server";
import { allocateInspectionRequestCode } from "@/lib/reference-codes.server";
import { logAuditEvent } from "@/lib/audit/server";
import type { AuditActor, AuditSource } from "@/lib/audit/types";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { deleteBusinessInvoice } from "@/lib/invoices/server";
import { deleteBusinessQuotation } from "@/lib/quotations/server";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { FieldValue } from "firebase-admin/firestore";

/** Who triggered an inspection action — used for audit logging. */
export type InspectionActionActor = {
  actor: AuditActor;
  source: AuditSource;
};

const SYSTEM_ACTOR: InspectionActionActor = {
  actor: { uid: null, role: "system", name: null, email: null },
  source: "system",
};

const OWNER_ACTION_SUMMARY: Record<string, string> = {
  accept: "confirmed an request date",
  set_time: "set the inspection time window",
  propose: "proposed alternative inspection times",
  assign: "assigned the inspection to an inspector",
  cancel: "cancelled the inspection",
  complete: "marked the inspection completed",
  convert_to_booking: "converted the request into a job",
  mark_awaiting_decision: "sent the inspection quotation for decision",
};

type ServiceLookup = {
  name: string;
  businessType: string;
};

async function loadBusinessSummary(
  businessId: string,
): Promise<{
  businessName: string | null;
  bookingSlug: string | null;
  logoUrl: string | null;
  timezone: string;
}> {
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    return {
      businessName:
        typeof data.businessName === "string" ? data.businessName : null,
      bookingSlug:
        typeof data.bookingSlug === "string" ? data.bookingSlug : null,
      logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
      timezone:
        typeof data.timezone === "string" && data.timezone.trim()
          ? data.timezone.trim()
          : PLATFORM_TIME_ZONE,
    };
  } catch {
    return {
      businessName: null,
      bookingSlug: null,
      logoUrl: null,
      timezone: PLATFORM_TIME_ZONE,
    };
  }
}

async function lookupService(
  businessId: string,
  serviceId: string,
): Promise<ServiceLookup | null> {
  const snap = await adminDb
    .collection(COLLECTIONS.SERVICES)
    .doc(serviceId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId) return null;

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const businessType =
    typeof data.businessType === "string"
      ? data.businessType
      : typeof data.category === "string"
        ? data.category
        : "";
  return { name, businessType };
}

/** Creates a new request from a public booking submission. */
export async function createInspectionRequest(
  businessId: string,
  input: InspectionRequestInput,
  options: {
    customerId?: string | null;
    createdSource: InspectionRequestCreatedSource;
    scheduleOnCreate?: CalendarScheduleInput;
  },
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; error: string }
> {
  let serviceName: string | null = null;
  let serviceBusinessType: string | null = null;

  if (input.requestType === "existing_service" && input.serviceId) {
    const service = await lookupService(businessId, input.serviceId);
    if (!service || !service.name) {
      return { ok: false, error: "Selected service is no longer available." };
    }
    serviceName = service.name;
    serviceBusinessType = service.businessType;
  }

  const ref = adminDb.collection(REQUESTS_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();
  const requestCode = await allocateInspectionRequestCode();

  const schedule = options.scheduleOnCreate ?? null;
  if (schedule) {
    if (await isBusinessClosedOnDate(businessId, schedule.date)) {
      return {
        ok: false,
        error:
          "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
      };
    }

    const occupancy = await computeDaySlotOccupancy(businessId, schedule.date);
    if (
      rangeOverlapsFullSlots(
        occupancy.slots,
        schedule.startTime,
        schedule.endTime,
        "inspection",
      )
    ) {
      return {
        ok: false,
        error:
          "One or more time slots in that range are full for inspection requests. Choose another time or update capacity in Settings.",
      };
    }
  }

  const scheduledSlot = schedule
    ? {
        date: schedule.date,
        timeRange: timeRangeFromStartTime(schedule.startTime),
      }
    : null;

  await ref.set({
    id: ref.id,
    businessId,
    requestCode,
    status: (schedule
      ? "scheduled"
      : "pending") satisfies InspectionRequestStatus,
    requestType: input.requestType,
    serviceId: input.serviceId,
    serviceName,
    serviceBusinessType,
    customRequest: input.customRequest,
    customer: input.customer,
    customerId: options.customerId ?? null,
    createdSource: options.createdSource,
    address: input.address,
    preferredSlots: input.preferredSlots,
    ownerProposedSlots: [],
    scheduledSlot,
    scheduledStartTime: schedule?.startTime ?? null,
    scheduledEndTime: schedule?.endTime ?? null,
    assignedTo: null,
    ownerNote: null,
    customerNotes: input.customerNotes,
    budgetAud: input.budgetAud,
    customerImageUrls: input.customerImageUrls,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await ref.get();
  const request = mapInspectionDoc(ref.id, snap.data() ?? {});
  const summary = await loadBusinessSummary(businessId);
  await notifyBusinessOfNewRequest(request, summary);
  await notifyCustomerOfNewRequest(request, summary);
  return { ok: true, request };
}

/** Lists requests for a business, newest first. */
export async function listInspectionRequests(
  businessId: string,
): Promise<InspectionRequestDetail[]> {
  const snapshot = await adminDb
    .collection(REQUESTS_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(80)
    .get();

  return sortInspectionRequestsNewestFirst(
    snapshot.docs.map((doc) => mapInspectionDoc(doc.id, doc.data() ?? {})),
  );
}

export async function getInspectionRequest(
  id: string,
  businessId: string,
): Promise<InspectionRequestDetail | null> {
  const snap = await getRequestDocument(id);
  if (!snap) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId) return null;
  return mapInspectionDoc(snap.id, data);
}

type OwnerAction =
  | {
      type: "accept";
      slot: InspectionSlot;
      startTime: string;
      endTime: string;
      note?: string;
    }
  | { type: "set_time"; startTime: string; endTime: string }
  | { type: "propose"; slots: InspectionSlot[]; note?: string }
  | { type: "assign"; assignment: InspectionAssignment }
  | { type: "cancel"; note?: string }
  | { type: "complete"; note?: string }
  | {
      type: "convert_to_booking";
      slot: InspectionSlot;
      startTime: string;
      endTime: string;
      estimatedDurationMinutes: number;
      note?: string;
      instructionDescription?: string;
      instructionTasks?: string[];
      assignedTo?: InspectionAssignment | null;
    }
  | { type: "mark_awaiting_decision"; note?: string };

export async function applyOwnerAction(
  id: string,
  businessId: string,
  action: OwnerAction,
  audit: InspectionActionActor = SYSTEM_ACTOR,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = snap.data();
  if (!current || current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  // An "accept" on an already-scheduled visit is a reschedule (e.g. the visit
  // was dragged to a new slot on the calendar), not a first-time confirmation.
  const isReschedule =
    action.type === "accept" &&
    current.status === "scheduled" &&
    !!current.scheduledSlot;

  if (action.type === "accept") {
    if (await isBusinessClosedOnDate(businessId, action.slot.date)) {
      return {
        ok: false,
        status: 400,
        error:
          "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
      };
    }

    const occupancy = await computeDaySlotOccupancy(
      businessId,
      action.slot.date,
    );
    if (
      rangeOverlapsFullSlots(
        occupancy.slots,
        action.startTime,
        action.endTime,
        "inspection",
      )
    ) {
      return {
        ok: false,
        status: 400,
        error:
          "One or more time slots in that range are full for inspection requests. Choose another time or update capacity in Settings.",
      };
    }
    updates.status = "scheduled" satisfies InspectionRequestStatus;
    updates.scheduledSlot = action.slot;
    updates.scheduledStartTime = action.startTime;
    updates.scheduledEndTime = action.endTime;
    updates.ownerProposedSlots = [];
    if (typeof action.note === "string") updates.ownerNote = action.note;
  } else if (action.type === "set_time") {
    if (current.status !== "scheduled" || !current.scheduledSlot) {
      return {
        ok: false,
        status: 400,
        error: "Confirm a visit date before setting the time window.",
      };
    }
    updates.scheduledStartTime = action.startTime;
    updates.scheduledEndTime = action.endTime;
  } else if (action.type === "propose") {
    if (action.slots.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Provide at least one proposed slot.",
      };
    }
    updates.status = "owner_proposed" satisfies InspectionRequestStatus;
    updates.ownerProposedSlots = action.slots.slice(0, 3);
    updates.scheduledSlot = null;
    updates.scheduledStartTime = null;
    updates.scheduledEndTime = null;
    if (typeof action.note === "string") updates.ownerNote = action.note;
  } else if (action.type === "assign") {
    if (current.status !== "scheduled") {
      return {
        ok: false,
        status: 400,
        error: "Schedule the visit before assigning it.",
      };
    }
    updates.assignedTo = action.assignment;
  } else if (action.type === "cancel") {
    updates.status = "cancelled" satisfies InspectionRequestStatus;
    // Keep the scheduled slot/time window and all other request data so the
    // customer (and their full details up to the point of cancellation) stay
    // viewable in the customer section. Cancelled requests are already
    // excluded from slot occupancy and the calendar, so preserving these
    // values does not block new scheduling.
    updates.cancelledAt = FieldValue.serverTimestamp();
    if (typeof action.note === "string") updates.ownerNote = action.note;
  } else if (action.type === "complete") {
    return {
      ok: false,
      status: 400,
      error:
        "Save a quotation to finish this visit. The request stays scheduled until the quotation is created.",
    };
  } else if (action.type === "convert_to_booking") {
    const created = await createBookingFromInspection({
      inspectionRequestId: id,
      businessId,
      slot: action.slot,
      startTime: action.startTime,
      endTime: action.endTime,
      estimatedDurationMinutes: action.estimatedDurationMinutes,
      note: action.note,
      instructionDescription: action.instructionDescription,
      instructionTasks: action.instructionTasks,
      assignedTo: action.assignedTo ?? null,
    });
    if (!created.ok) {
      return {
        ok: false,
        status: created.status,
        error: created.error,
      };
    }
    const summary = await loadBusinessSummary(businessId);
    await notifyCustomerOfJobScheduled(created.booking, summary);
    await logAuditEvent({
      businessId,
      category: "booking",
      action: "booking.created",
      actor: audit.actor,
      source: audit.source,
      summary: `Job ${created.booking.bookingCode ?? created.booking.id} created from request ${created.request.requestCode ?? id}`,
      targetId: created.booking.id,
      targetLabel:
        created.booking.bookingCode ||
        created.request.serviceName ||
        created.request.customer.fullName ||
        null,
      metadata: {
        inspectionId: id,
        bookingCode: created.booking.bookingCode ?? null,
        estimatedDurationMinutes: action.estimatedDurationMinutes,
      },
    });
    await logAuditEvent({
      businessId,
      category: "inspection",
      action: "inspection.convert_to_booking",
      actor: audit.actor,
      source: audit.source,
      summary: `${audit.actor.name ?? audit.actor.email ?? "Someone"} converted the request into a job`,
      targetId: id,
      targetLabel:
        created.request.serviceName ||
        created.request.customer.fullName ||
        null,
      metadata: { requestCode: created.request.requestCode ?? null },
    });
    return { ok: true, request: created.request };
  } else if (action.type === "mark_awaiting_decision") {
    if (
      current.status !== "completed" &&
      current.status !== "scheduled" &&
      current.status !== "awaiting_decision"
    ) {
      return {
        ok: false,
        status: 400,
        error:
          "Only visits with a quotation can be marked awaiting decision.",
      };
    }
    if (!current.quotation) {
      return {
        ok: false,
        status: 400,
        error: "Send a quotation before marking awaiting decision.",
      };
    }
    const bookingStatusAt = FieldValue.serverTimestamp();
    updates.status = "awaiting_decision" satisfies InspectionRequestStatus;
    updates.bookingStatus = "awaiting";
    updates.bookingStatusAt = bookingStatusAt;
    if (typeof action.note === "string") updates.ownerNote = action.note;
  }

  await ref.update(updates);

  if (action.type === "mark_awaiting_decision") {
    try {
      const bookingStatusAt = updates.bookingStatusAt as ReturnType<
        typeof FieldValue.serverTimestamp
      >;
      await mirrorBookingToQuotations(id, {
        bookingStatus: "awaiting",
        bookingStatusAt,
      });
    } catch (error) {
      console.error("quotation bookingStatus mirror failed:", error);
    }
  }
  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});

  const summary = await loadBusinessSummary(businessId);
  if (action.type === "assign") {
    await notifyCustomerOfAssignment(request, summary);
    const assigned = request.assignedTo;
    if (assigned?.type === "staff" && assigned.uid) {
      const headline = request.serviceName ?? request.requestCode ?? "Inspection";
      const slot = request.scheduledSlot;
      const when = slot
        ? `${slot.date}${request.scheduledStartTime ? ` · ${request.scheduledStartTime}` : ""}`
        : null;
      await sendStaffMobilePush({
        uid: assigned.uid,
        title: "Visit assigned to you",
        body: when
          ? `You are scheduled for ${headline} on ${when}.`
          : `You have been assigned to ${headline}.`,
        data: {
          type: "staff_assignment",
          requestId: request.id,
          audience: "staff",
        },
      });
    }
  } else if (isReschedule && request.status === "scheduled") {
    await notifyCustomerOfRequestRescheduled(request, summary);
  } else {
    await notifyCustomerOfStatusChange(request, request.status, summary);
  }

  await logAuditEvent({
    businessId,
    category: "inspection",
    action: `inspection.${action.type}`,
    actor: audit.actor,
    source: audit.source,
    summary: `${audit.actor.name ?? audit.actor.email ?? "Someone"} ${
      OWNER_ACTION_SUMMARY[action.type] ?? "updated the inspection"
    } (${request.requestCode ?? id})`,
    targetId: id,
    targetLabel: request.serviceName || request.customer.fullName || null,
    metadata: {
      requestCode: request.requestCode ?? null,
      status: request.status,
    },
  });

  return { ok: true, request };
}

export async function applyStaffStart(
  id: string,
  businessId: string,
  inspectorUid: string,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = snap.data();
  if (!current || current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (current.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled visits can be started.",
    };
  }

  const assigned = current.assignedTo as { uid?: string } | null;
  if (!assigned?.uid || assigned.uid !== inspectorUid) {
    return {
      ok: false,
      status: 403,
      error: "This visit is not assigned to you.",
    };
  }

  if (current.visitStartedAt) {
    return {
      ok: false,
      status: 400,
      error: "This visit has already been started.",
    };
  }

  await ref.update({
    visitStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});
  const summary = await loadBusinessSummary(businessId);
  await notifyCustomerOfVisitOnTheWay(request, summary);

  return { ok: true, request };
}

export async function applyAssignedEndVisit(
  id: string,
  businessId: string,
  inspectorUid: string,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = snap.data();
  if (!current || current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (current.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled visits can be ended.",
    };
  }

  if (!current.visitStartedAt) {
    return {
      ok: false,
      status: 400,
      error: "Start the visit before ending it.",
    };
  }

  const assigned = current.assignedTo as { uid?: string } | null;
  if (!assigned?.uid || assigned.uid !== inspectorUid) {
    return {
      ok: false,
      status: 403,
      error: "This visit is not assigned to you.",
    };
  }

  if (current.visitEndedAt) {
    const after = await ref.get();
    return {
      ok: true,
      request: mapInspectionDoc(ref.id, after.data() ?? {}),
    };
  }

  await ref.update({
    visitEndedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  return { ok: true, request: mapInspectionDoc(ref.id, after.data() ?? {}) };
}

/**
 * Customer accepts one of the owner-proposed slots. The visit is scheduled on
 * that date/time-range, but the owner still needs to set the exact time window.
 */
export async function customerAcceptProposedSlot(
  id: string,
  identity: CustomerOwnershipIdentity,
  slot: InspectionSlot,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = mapInspectionDoc(snap.id, snap.data() ?? {});

  if (!customerOwnsRequestRecord(current, identity)) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (current.status !== "owner_proposed") {
    return {
      ok: false,
      status: 400,
      error: "There are no proposed times to accept right now.",
    };
  }

  const matched = current.ownerProposedSlots.find(
    (option) => option.date === slot.date && option.timeRange === slot.timeRange,
  );
  if (!matched) {
    return {
      ok: false,
      status: 400,
      error: "That time is no longer offered. Please pick another option.",
    };
  }

  if (await isBusinessClosedOnDate(current.businessId, matched.date)) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Please choose another day.",
    };
  }

  await ref.update({
    status: "scheduled" satisfies InspectionRequestStatus,
    scheduledSlot: matched,
    scheduledStartTime: null,
    scheduledEndTime: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});

  const summary = await loadBusinessSummary(request.businessId);
  await notifyBusinessOfCustomerAcceptance(request, summary);

  await logAuditEvent({
    businessId: request.businessId,
    category: "inspection",
    action: "inspection.slot_accepted",
    actor: {
      uid: identity.customerId,
      role: "customer",
      name: request.customer.fullName || null,
      email: identity.customerEmail || request.customer.email || null,
    },
    source: "customer_portal",
    summary: `Customer accepted a proposed time for inspection ${request.requestCode ?? id}`,
    targetId: id,
    targetLabel: request.serviceName || request.customer.fullName || null,
    metadata: {
      requestCode: request.requestCode ?? null,
      slot: matched,
    },
  });

  return { ok: true, request };
}

/** Admin proposes alternative job days to the customer after quotation acceptance. */
export async function proposeJobDatesToCustomer(
  id: string,
  businessId: string,
  slots: InspectionSlot[],
  note?: string | null,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const data = snap.data() ?? {};
  if (data.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const request = mapInspectionDoc(snap.id, data);
  if (!request.quotation || request.quotation.customerDecision !== "accepted") {
    return {
      ok: false,
      status: 400,
      error:
        "Job days can only be proposed after the customer accepts the quotation.",
    };
  }
  if (request.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "This request already has a scheduled job.",
    };
  }

  const trimmedNote =
    typeof note === "string" && note.trim() ? note.trim() : null;

  await snap.ref.set(
    {
      jobProposedSlots: slots,
      adminJobPreferredSlots: slots,
      customerAcceptedJobSlot: null,
      ...(trimmedNote ? { ownerNote: trimmedNote } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const after = await snap.ref.get();
  const updated = mapInspectionDoc(snap.id, after.data() ?? {});

  try {
    const { notifyCustomerOfJobDatesProposed } = await import(
      "@/lib/notifications/server"
    );
    const summary = await loadBusinessSummary(businessId);
    await notifyCustomerOfJobDatesProposed(updated, summary);
  } catch (error) {
    console.error("job dates proposed notification failed:", error);
  }

  return { ok: true, request: updated };
}

/** @deprecated Use proposeJobDatesToCustomer */
export async function updateAdminJobPreferredSlots(
  id: string,
  businessId: string,
  slots: InspectionSlot[],
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  return proposeJobDatesToCustomer(id, businessId, slots);
}

/** Customer accepts one of the admin-proposed job days. */
export async function customerAcceptJobProposedSlot(
  id: string,
  identity: CustomerOwnershipIdentity,
  slot: InspectionSlot,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = mapInspectionDoc(snap.id, snap.data() ?? {});

  if (!customerOwnsRequestRecord(current, identity)) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (!current.quotation || current.quotation.customerDecision !== "accepted") {
    return {
      ok: false,
      status: 400,
      error: "There are no proposed job days to accept right now.",
    };
  }
  if (current.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "This job has already been scheduled.",
    };
  }
  if (current.jobProposedSlots.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "There are no proposed job days to accept right now.",
    };
  }

  const matched = current.jobProposedSlots.find(
    (option) =>
      option.date === slot.date && option.timeRange === slot.timeRange,
  );
  if (!matched) {
    return {
      ok: false,
      status: 400,
      error: "That day is no longer offered. Please pick another option.",
    };
  }

  if (await isBusinessClosedOnDate(current.businessId, matched.date)) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Please choose another day.",
    };
  }

  await ref.update({
    customerAcceptedJobSlot: matched,
    jobProposedSlots: [],
    updatedAt: FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});

  try {
    const { notifyBusinessOfCustomerJobDateAcceptance } = await import(
      "@/lib/notifications/server"
    );
    const summary = await loadBusinessSummary(request.businessId);
    await notifyBusinessOfCustomerJobDateAcceptance(request, summary);
  } catch (error) {
    console.error("customer job date acceptance notification failed:", error);
  }

  await logAuditEvent({
    businessId: request.businessId,
    category: "booking",
    action: "booking.job_date_accepted",
    actor: {
      uid: identity.customerId,
      role: "customer",
      name: request.customer.fullName || null,
      email: identity.customerEmail || request.customer.email || null,
    },
    source: "customer_portal",
    summary: `Customer accepted a proposed job day for ${request.requestCode ?? id}`,
    targetId: id,
    targetLabel: request.serviceName || request.customer.fullName || null,
    metadata: {
      requestCode: request.requestCode ?? null,
      slot: matched,
    },
  });

  return { ok: true, request };
}

/** Customer declines all admin-proposed job days. */
export async function customerRejectJobProposedSlots(
  id: string,
  identity: CustomerOwnershipIdentity,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const ref = snap.ref;
  const current = mapInspectionDoc(snap.id, snap.data() ?? {});

  if (!customerOwnsRequestRecord(current, identity)) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (!current.quotation || current.quotation.customerDecision !== "accepted") {
    return {
      ok: false,
      status: 400,
      error: "There are no proposed job days to reject right now.",
    };
  }
  if (current.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "This job has already been scheduled.",
    };
  }
  if (current.jobProposedSlots.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "There are no proposed job days to reject right now.",
    };
  }

  await ref.update({
    jobProposedSlots: [],
    adminJobPreferredSlots: [],
    updatedAt: FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});

  try {
    const { notifyBusinessOfCustomerJobProposalRejection } = await import(
      "@/lib/notifications/server"
    );
    const summary = await loadBusinessSummary(request.businessId);
    await notifyBusinessOfCustomerJobProposalRejection(request, summary);
  } catch (error) {
    console.error("customer job date rejection notification failed:", error);
  }

  await logAuditEvent({
    businessId: request.businessId,
    category: "booking",
    action: "booking.job_date_rejected",
    actor: {
      uid: identity.customerId,
      role: "customer",
      name: request.customer.fullName || null,
      email: identity.customerEmail || request.customer.email || null,
    },
    source: "customer_portal",
    summary: `Customer rejected proposed job days for ${request.requestCode ?? id}`,
    targetId: id,
    targetLabel: request.serviceName || request.customer.fullName || null,
    metadata: {
      requestCode: request.requestCode ?? null,
    },
  });

  return { ok: true, request };
}

/** Permanently removes a request and any linked job, quotation, or invoice. */
export async function deleteBusinessInspectionRequest(
  businessId: string,
  requestId: string,
): Promise<
  | {
      ok: true;
      request: InspectionRequestDetail;
      deletedJob: boolean;
      deletedQuotation: boolean;
      deletedInvoice: boolean;
    }
  | { ok: false; status: number; error: string }
> {
  const id = requestId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Request is required." };
  }

  const snap = await getRequestDocument(id);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const data = snap.data();
  if (!data || data.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const request = mapInspectionDoc(snap.id, data);
  let deletedJob = false;
  let deletedQuotation = false;
  let deletedInvoice = false;

  const bookingId =
    typeof data.bookingId === "string" ? data.bookingId.trim() : "";
  if (bookingId) {
    const jobRef = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
    const jobSnap = await jobRef.get();
    if (jobSnap.exists && jobSnap.data()?.businessId === businessId) {
      await jobRef.delete();
      deletedJob = true;
    }
  }

  const quotationId = request.quotation?.id?.trim() ?? "";
  if (quotationId) {
    const quotationResult = await deleteBusinessQuotation(
      businessId,
      quotationId,
    );
    if (quotationResult.ok) {
      deletedQuotation = true;
      deletedInvoice = quotationResult.deletedInvoice;
    }
  } else {
    const invoiceId = request.invoice?.id?.trim() ?? "";
    if (invoiceId) {
      const invoiceResult = await deleteBusinessInvoice(businessId, invoiceId);
      if (invoiceResult.ok) {
        deletedInvoice = true;
      }
    }
  }

  await snap.ref.delete();

  return {
    ok: true,
    request,
    deletedJob,
    deletedQuotation,
    deletedInvoice,
  };
}
