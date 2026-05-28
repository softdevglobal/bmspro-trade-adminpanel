import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  INSPECTION_COLLECTION,
  REQUEST_STATUSES,
  isRequestType,
  isTimeRange,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionRequestDetail,
  type InspectionRequestInput,
  type InspectionRequestStatus,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { FieldValue } from "firebase-admin/firestore";

type ServiceLookup = {
  name: string;
  businessType: string;
};

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

function parseAddress(raw: unknown): InspectionAddress {
  if (!raw || typeof raw !== "object") {
    return { street: "", suburb: "", state: "", postcode: "" };
  }
  const item = raw as Record<string, unknown>;
  return {
    street: typeof item.street === "string" ? item.street : "",
    suburb: typeof item.suburb === "string" ? item.suburb : "",
    state: typeof item.state === "string" ? item.state : "",
    postcode: typeof item.postcode === "string" ? item.postcode : "",
  };
}

function parseCustomer(raw: unknown): InspectionCustomer {
  if (!raw || typeof raw !== "object") {
    return { fullName: "", email: "", phone: "" };
  }
  const item = raw as Record<string, unknown>;
  return {
    fullName: typeof item.fullName === "string" ? item.fullName : "",
    email: typeof item.email === "string" ? item.email : "",
    phone: typeof item.phone === "string" ? item.phone : "",
  };
}

function parseSlots(raw: unknown): InspectionSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const date = typeof item.date === "string" ? item.date : null;
      const timeRange = item.timeRange;
      if (!date || !isTimeRange(timeRange)) return null;
      return { date, timeRange } satisfies InspectionSlot;
    })
    .filter((slot): slot is InspectionSlot => slot !== null);
}

function parseAssignment(raw: unknown): InspectionAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const type = item.type === "owner" ? "owner" : "staff";
  const uid = typeof item.uid === "string" ? item.uid : "";
  const name = typeof item.name === "string" ? item.name : "";
  const email = typeof item.email === "string" ? item.email : null;
  if (!uid) return null;
  return { type, uid, name, email };
}

function parseStatus(raw: unknown): InspectionRequestStatus {
  if (typeof raw !== "string") return "pending";
  return REQUEST_STATUSES.includes(raw as InspectionRequestStatus)
    ? (raw as InspectionRequestStatus)
    : "pending";
}

function mapInspectionDoc(
  id: string,
  data: Record<string, unknown>,
): InspectionRequestDetail {
  const requestType = isRequestType(data.requestType)
    ? data.requestType
    : "existing_service";

  const customRequestRaw = data.customRequest;
  const customRequest =
    customRequestRaw && typeof customRequestRaw === "object"
      ? {
          title:
            typeof (customRequestRaw as Record<string, unknown>).title ===
            "string"
              ? ((customRequestRaw as Record<string, unknown>).title as string)
              : "",
          description:
            typeof (customRequestRaw as Record<string, unknown>).description ===
            "string"
              ? ((customRequestRaw as Record<string, unknown>)
                  .description as string)
              : "",
        }
      : null;

  return {
    id,
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    status: parseStatus(data.status),
    requestType,
    serviceId: typeof data.serviceId === "string" ? data.serviceId : null,
    serviceName: typeof data.serviceName === "string" ? data.serviceName : null,
    serviceBusinessType:
      typeof data.serviceBusinessType === "string"
        ? data.serviceBusinessType
        : null,
    customRequest,
    customer: parseCustomer(data.customer),
    address: parseAddress(data.address),
    preferredSlots: parseSlots(data.preferredSlots),
    ownerProposedSlots: parseSlots(data.ownerProposedSlots),
    scheduledSlot: (() => {
      const slots = parseSlots([data.scheduledSlot]);
      return slots[0] ?? null;
    })(),
    assignedTo: parseAssignment(data.assignedTo),
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Creates a new inspection request from a public booking submission. */
export async function createInspectionRequest(
  businessId: string,
  input: InspectionRequestInput,
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
    address: input.address,
    preferredSlots: input.preferredSlots,
    ownerProposedSlots: [],
    scheduledSlot: null,
    assignedTo: null,
    ownerNote: null,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await ref.get();
  return { ok: true, request: mapInspectionDoc(ref.id, snap.data() ?? {}) };
}

/** Lists inspection requests for a business, newest first. */
export async function listInspectionRequests(
  businessId: string,
): Promise<InspectionRequestDetail[]> {
  const snapshot = await adminDb
    .collection(INSPECTION_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  return snapshot.docs
    .map((doc) => mapInspectionDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
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
  | { type: "accept"; slot: InspectionSlot; note?: string }
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
    updates.ownerProposedSlots = [];
    if (typeof action.note === "string") updates.ownerNote = action.note;
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
    if (typeof action.note === "string") updates.ownerNote = action.note;
  } else if (action.type === "complete") {
    updates.status = "completed" satisfies InspectionRequestStatus;
    if (typeof action.note === "string") updates.ownerNote = action.note;
  }

  await ref.update(updates);
  const after = await ref.get();
  return { ok: true, request: mapInspectionDoc(ref.id, after.data() ?? {}) };
}
