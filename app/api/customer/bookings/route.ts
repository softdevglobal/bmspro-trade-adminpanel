import { adminDb } from "@/lib/firebase/admin";
import { authenticateCustomerRequest } from "@/lib/customer/server";
import {
  INSPECTION_COLLECTION,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  REQUEST_STATUSES,
  isRequestType,
  isTimeRange,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { toMillis } from "@/lib/onboarding/services/display";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export type CustomerBooking = InspectionRequestDetail & {
  businessName: string | null;
  bookingSlug: string | null;
};

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

function mapBookingDoc(
  id: string,
  data: Record<string, unknown>,
): InspectionRequestDetail {
  const requestType = isRequestType(data.requestType)
    ? data.requestType
    : "existing_service";

  const customRequestRaw = data.customRequest as Record<string, unknown> | null;
  const customRequest =
    customRequestRaw && typeof customRequestRaw === "object"
      ? {
          title:
            typeof customRequestRaw.title === "string"
              ? customRequestRaw.title
              : "",
          description:
            typeof customRequestRaw.description === "string"
              ? customRequestRaw.description
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
    customerId: typeof data.customerId === "string" ? data.customerId : null,
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

async function loadBusinessSummaries(
  ids: string[],
): Promise<Map<string, { businessName: string | null; bookingSlug: string | null }>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));
  const result = new Map<
    string,
    { businessName: string | null; bookingSlug: string | null }
  >();

  await Promise.all(
    unique.map(async (id) => {
      const snap = await adminDb.collection("businesses").doc(id).get();
      if (!snap.exists) {
        result.set(id, { businessName: null, bookingSlug: null });
        return;
      }
      const data = snap.data() ?? {};
      result.set(id, {
        businessName:
          typeof data.businessName === "string" ? data.businessName : null,
        bookingSlug:
          typeof data.bookingSlug === "string" ? data.bookingSlug : null,
      });
    }),
  );

  return result;
}

export async function GET(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const byCustomerId = await adminDb
    .collection(INSPECTION_COLLECTION)
    .where("customerId", "==", auth.customer.uid)
    .get();

  const byEmail = await adminDb
    .collection(INSPECTION_COLLECTION)
    .where("customer.email", "==", auth.customer.email)
    .get();

  const docs = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of byCustomerId.docs) {
    docs.set(doc.id, doc.data());
  }
  for (const doc of byEmail.docs) {
    if (!docs.has(doc.id)) docs.set(doc.id, doc.data());
  }

  const requests = Array.from(docs.entries()).map(([id, data]) =>
    mapBookingDoc(id, data),
  );

  const businessLookup = await loadBusinessSummaries(
    requests.map((req) => req.businessId).filter((id): id is string => !!id),
  );

  const enriched: CustomerBooking[] = requests
    .map((req) => {
      const summary = businessLookup.get(req.businessId);
      return {
        ...req,
        businessName: summary?.businessName ?? null,
        bookingSlug: summary?.bookingSlug ?? null,
      } satisfies CustomerBooking;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return NextResponse.json({ ok: true, bookings: enriched });
}
