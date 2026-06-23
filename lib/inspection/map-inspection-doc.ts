import { parseBookingStatus } from "@/lib/bookings/types";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  REQUEST_STATUSES,
  UNSCHEDULED_SORT_KEY,
  inspectionRequestScheduleSortKey,
  isClockTime,
  isRequestType,
  isTimeRange,
  parseCustomerImageUrls,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
  parseCreatedSource,
  parseInspectionInvoice,
  parseInspectionQuotation,
} from "@/lib/inspection/types";

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

/** Maps a Firestore requests document for API and client listeners. */
export function mapInspectionDoc(
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
    customerId: typeof data.customerId === "string" ? data.customerId : null,
    createdSource: parseCreatedSource(data.createdSource),
    requestCode:
      typeof data.requestCode === "string" && data.requestCode.trim()
        ? data.requestCode.trim()
        : null,
    address: parseAddress(data.address),
    preferredSlots: parseSlots(data.preferredSlots),
    ownerProposedSlots: parseSlots(data.ownerProposedSlots),
    jobPreferredSlots: parseSlots(data.jobPreferredSlots),
    adminJobPreferredSlots: parseSlots(data.adminJobPreferredSlots),
    jobProposedSlots: parseSlots(data.jobProposedSlots),
    customerAcceptedJobSlot: (() => {
      const slots = parseSlots([data.customerAcceptedJobSlot]);
      return slots[0] ?? null;
    })(),
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
    customerImageUrls: parseCustomerImageUrls(data.customerImageUrls),
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

export function sortInspectionRequestsNewestFirst(
  records: InspectionRequestDetail[],
): InspectionRequestDetail[] {
  return [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function sortInspectionRequestsBySchedule(
  records: InspectionRequestDetail[],
): InspectionRequestDetail[] {
  return [...records].sort((a, b) => {
    const keyA = inspectionRequestScheduleSortKey(a);
    const keyB = inspectionRequestScheduleSortKey(b);
    const scheduledA = keyA !== UNSCHEDULED_SORT_KEY;
    const scheduledB = keyB !== UNSCHEDULED_SORT_KEY;
    if (scheduledA && scheduledB) return keyA.localeCompare(keyB);
    if (scheduledA) return -1;
    if (scheduledB) return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}
