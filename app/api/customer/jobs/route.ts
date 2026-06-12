import { parseBookingStatus } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateCustomerRequest } from "@/lib/customer/server";
import {
  REQUESTS_COLLECTION,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  REQUEST_STATUSES,
  isClockTime,
  isRequestType,
  isTimeRange,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionSlot,
  parseCreatedSource,
  parseInspectionInvoice,
  parseInspectionQuotation,
} from "@/lib/inspection/types";
import {
  enrichRequestsWithInvoices,
  enrichRequestsWithJobAssignees,
} from "@/lib/invoices/enrich-customer-requests";
import { toMillis } from "@/lib/onboarding/services/display";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export type CustomerBooking = InspectionRequestDetail & {
  businessName: string | null;
  bookingSlug: string | null;
  jobAssignedTo: InspectionAssignment | null;
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
    createdSource: parseCreatedSource(data.createdSource),
    requestCode:
      typeof data.requestCode === "string" && data.requestCode.trim()
        ? data.requestCode.trim()
        : null,
    address: parseAddress(data.address),
    preferredSlots: parseSlots(data.preferredSlots),
    ownerProposedSlots: parseSlots(data.ownerProposedSlots),
    scheduledSlot: (() => {
      const slots = parseSlots([data.scheduledSlot]);
      return slots[0] ?? null;
    })(),
    scheduledStartTime: isClockTime(data.scheduledStartTime)
      ? data.scheduledStartTime
      : null,
    scheduledEndTime: isClockTime(data.scheduledEndTime)
      ? data.scheduledEndTime
      : null,
    assignedTo: parseAssignment(data.assignedTo),
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : null,
    customerNotes:
      typeof data.customerNotes === "string" && data.customerNotes.trim()
        ? data.customerNotes.trim()
        : null,
    budgetAud:
      typeof data.budgetAud === "number" && Number.isFinite(data.budgetAud)
        ? data.budgetAud
        : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    visitStartedAt: toMillis(data.visitStartedAt),
    visitEndedAt: toMillis(data.visitEndedAt),
    quotation: parseInspectionQuotation(data.quotation),
    invoice: parseInspectionInvoice(data.invoice),
    bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
    bookingCode:
      typeof data.bookingCode === "string" && data.bookingCode.trim()
        ? data.bookingCode.trim()
        : null,
    bookingStatus: (() => {
      const parsed = parseBookingStatus(data.bookingStatus);
      if (parsed) return parsed;
      if (typeof data.bookingId === "string" && data.bookingId.trim()) {
        return "scheduled";
      }
      if (parseInspectionQuotation(data.quotation)) {
        return "awaiting";
      }
      if (data.status === "awaiting_decision") {
        return "awaiting";
      }
      return null;
    })(),
    bookingStatusAt: toMillis(data.bookingStatusAt),
    estimatedDurationMinutes:
      typeof data.estimatedDurationMinutes === "number" &&
      Number.isFinite(data.estimatedDurationMinutes) &&
      data.estimatedDurationMinutes > 0
        ? Math.round(data.estimatedDurationMinutes)
        : null,
    bookingConfirmedAt: toMillis(data.bookingConfirmedAt),
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

  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const refs = chunk.map((id) => adminDb.collection("businesses").doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) {
        result.set(snap.id, { businessName: null, bookingSlug: null });
        continue;
      }
      const data = snap.data() ?? {};
      result.set(snap.id, {
        businessName:
          typeof data.businessName === "string" ? data.businessName : null,
        bookingSlug:
          typeof data.bookingSlug === "string" ? data.bookingSlug : null,
      });
    }
  }

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
    .collection(REQUESTS_COLLECTION)
    .where("customerId", "==", auth.customer.uid)
    .limit(100)
    .get();

  const byEmail = await adminDb
    .collection(REQUESTS_COLLECTION)
    .where("customer.email", "==", auth.customer.email)
    .limit(100)
    .get();

  const docs = new Map<string, FirebaseFirestore.DocumentData>();
  for (const doc of byCustomerId.docs) {
    docs.set(doc.id, doc.data());
  }
  for (const doc of byEmail.docs) {
    if (!docs.has(doc.id)) docs.set(doc.id, doc.data());
  }

  const requests = await enrichRequestsWithJobAssignees(
    await enrichRequestsWithInvoices(
      Array.from(docs.entries()).map(([id, data]) => mapBookingDoc(id, data)),
    ),
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
        jobAssignedTo: req.jobAssignedTo ?? null,
      } satisfies CustomerBooking;
    })
    .sort(
      (a, b) =>
        (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
    );

  return NextResponse.json({ ok: true, jobs: enriched });
}
