import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import {
  mapInspectionDoc,
  sortInspectionRequestsNewestFirst,
} from "@/lib/inspection/map-inspection-doc";
import { getRequestDocument } from "@/lib/inspection/request-document";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import type {
  InspectionAssignment,
  InspectionRequestCreatedSource,
  InspectionRequestDetail,
  InspectionRequestInput,
  InspectionRequestStatus,
  InspectionSlot,
} from "@/lib/inspection/types";
import {
  notifyBusinessOfCustomerAcceptance,
  notifyBusinessOfNewRequest,
  notifyCustomerOfAssignment,
  notifyCustomerOfNewRequest,
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

  await ref.set({
    id: ref.id,
    businessId,
    requestCode,
    status: "pending" satisfies InspectionRequestStatus,
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
    scheduledSlot: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignedTo: null,
    ownerNote: null,
    customerNotes: input.customerNotes,
    budgetAud: input.budgetAud,
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

  if (action.type === "accept") {
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
    updates.scheduledStartTime = null;
    updates.scheduledEndTime = null;
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
    await notifyCustomerOfStatusChange(
      created.request,
      "scheduled",
      summary,
    );
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
  identity: { customerId: string; customerEmail: string },
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

  const ownsById =
    !!current.customerId && current.customerId === identity.customerId;
  const ownsByEmail =
    !!identity.customerEmail &&
    current.customer.email.toLowerCase() ===
      identity.customerEmail.toLowerCase();
  if (!ownsById && !ownsByEmail) {
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
