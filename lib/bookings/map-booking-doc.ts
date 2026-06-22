import { parseJobInstructionsFromDoc } from "@/lib/bookings/job-instructions";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  BOOKING_STATUSES,
  type BookingDetail,
  type BookingStatus,
} from "@/lib/bookings/types";
import {
  isClockTime,
  isRequestType,
  isTimeRange,
  resolveSlotStartTime,
  UNSCHEDULED_SORT_KEY,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionSlot,
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

function parseSlot(raw: unknown): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : null;
  const timeRange = item.timeRange;
  if (!date || !isTimeRange(timeRange)) return null;
  return { date, timeRange };
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

function parseStatus(raw: unknown): BookingStatus {
  if (typeof raw !== "string") return "scheduled";
  return BOOKING_STATUSES.includes(raw as BookingStatus)
    ? (raw as BookingStatus)
    : "scheduled";
}

function parseImageUrlList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim())
    .slice(0, 5);
}

export function mapBookingDoc(
  id: string,
  data: Record<string, unknown>,
): BookingDetail {
  const requestType = isRequestType(data.requestType)
    ? data.requestType
    : "existing_service";

  const jobInstructions = parseJobInstructionsFromDoc(data);
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
    bookingCode:
      typeof data.bookingCode === "string" && data.bookingCode.trim()
        ? data.bookingCode.trim()
        : null,
    inspectionRequestId:
      typeof data.inspectionRequestId === "string"
        ? data.inspectionRequestId
        : "",
    inspectionRequestCode:
      typeof data.inspectionRequestCode === "string" &&
      data.inspectionRequestCode.trim()
        ? data.inspectionRequestCode.trim()
        : null,
    quotationId:
      typeof data.quotationId === "string" ? data.quotationId : null,
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
    scheduledSlot: parseSlot(data.scheduledSlot),
    scheduledStartTime: isClockTime(data.scheduledStartTime)
      ? data.scheduledStartTime
      : null,
    scheduledEndTime: isClockTime(data.scheduledEndTime)
      ? data.scheduledEndTime
      : null,
    estimatedDurationMinutes:
      typeof data.estimatedDurationMinutes === "number" &&
      Number.isFinite(data.estimatedDurationMinutes) &&
      data.estimatedDurationMinutes > 0
        ? Math.round(data.estimatedDurationMinutes)
        : null,
    assignedTo: parseAssignment(data.assignedTo),
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote : null,
    jobInstructionsDescription: jobInstructions.jobInstructionsDescription,
    jobInstructionsTasks: jobInstructions.jobInstructionsTasks,
    quotation: parseInspectionQuotation(data.quotation),
    visitStartedAt: toMillis(data.visitStartedAt),
    visitEndedAt: toMillis(data.visitEndedAt),
    bookingStartedAt: toMillis(data.bookingStartedAt),
    completedFromInvoice: data.completedFromInvoice === true,
    beforeImageUrls: parseImageUrlList(data.beforeImageUrls),
    afterImageUrls: parseImageUrlList(data.afterImageUrls),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export function sortBookingsNewestFirst(records: BookingDetail[]): BookingDetail[] {
  return [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function bookingScheduleSortKey(booking: BookingDetail): string {
  if (booking.scheduledSlot?.date) {
    const start =
      booking.scheduledStartTime && isClockTime(booking.scheduledStartTime)
        ? booking.scheduledStartTime
        : resolveSlotStartTime(booking.scheduledSlot);
    return `${booking.scheduledSlot.date}T${start}`;
  }
  return UNSCHEDULED_SORT_KEY;
}

export function sortBookingsBySchedule(records: BookingDetail[]): BookingDetail[] {
  return [...records].sort((a, b) => {
    const keyA = bookingScheduleSortKey(a);
    const keyB = bookingScheduleSortKey(b);
    const scheduledA = keyA !== UNSCHEDULED_SORT_KEY;
    const scheduledB = keyB !== UNSCHEDULED_SORT_KEY;
    if (scheduledA && scheduledB) return keyA.localeCompare(keyB);
    if (scheduledA) return -1;
    if (scheduledB) return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}
