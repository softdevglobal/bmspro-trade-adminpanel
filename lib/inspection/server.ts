import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import {
  mapInspectionDoc,
  sortInspectionRequestsNewestFirst,
} from "@/lib/inspection/map-inspection-doc";
import { INSPECTION_COLLECTION } from "@/lib/inspection/types";
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
import { FieldValue } from "firebase-admin/firestore";

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
    };
  } catch {
    return { businessName: null, bookingSlug: null, logoUrl: null };
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

/** Creates a new inspection request from a public booking submission. */
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

  const ref = adminDb.collection(INSPECTION_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    businessId,
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

/** Lists inspection requests for a business, newest first. */
export async function listInspectionRequests(
  businessId: string,
): Promise<InspectionRequestDetail[]> {
  const snapshot = await adminDb
    .collection(INSPECTION_COLLECTION)
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
  const snap = await adminDb.collection(INSPECTION_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
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
  | { type: "complete"; note?: string };

export async function applyOwnerAction(
  id: string,
  businessId: string,
  action: OwnerAction,
): Promise<
  | { ok: true; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(INSPECTION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }
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
    updates.status = "completed" satisfies InspectionRequestStatus;
    if (typeof action.note === "string") updates.ownerNote = action.note;
  }

  await ref.update(updates);
  const after = await ref.get();
  const request = mapInspectionDoc(ref.id, after.data() ?? {});

  const summary = await loadBusinessSummary(businessId);
  if (action.type === "assign") {
    await notifyCustomerOfAssignment(request, summary);
  } else {
    await notifyCustomerOfStatusChange(request, request.status, summary);
  }

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
  const ref = adminDb.collection(INSPECTION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }

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
  const ref = adminDb.collection(INSPECTION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }

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
  const ref = adminDb.collection(INSPECTION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }
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

  return { ok: true, request };
}
