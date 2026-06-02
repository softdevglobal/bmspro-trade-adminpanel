import type {
  InspectionAddress,
  InspectionAssignment,
  InspectionCustomer,
  InspectionQuotationSummary,
  InspectionRequestType,
  InspectionSlot,
} from "@/lib/inspection/types";

export const BOOKING_COLLECTION = "bookings";

export const BOOKING_STATUSES = ["scheduled", "cancelled", "completed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const BOOKING_STATUS_TONE: Record<BookingStatus, string> = {
  scheduled:
    "bg-emerald-50 text-emerald-700 border border-emerald-200",
  cancelled:
    "bg-stone-100 text-stone-600 border border-stone-200",
  completed: "bg-sky-50 text-sky-700 border border-sky-200",
};

export function parseBookingStatus(raw: unknown): BookingStatus | null {
  if (
    typeof raw === "string" &&
    (BOOKING_STATUSES as readonly string[]).includes(raw)
  ) {
    return raw as BookingStatus;
  }
  return null;
}

export type BookingDetail = {
  id: string;
  businessId: string;
  /** Human-readable code, e.g. `BK 4K7H2M9P`. */
  bookingCode: string | null;
  inspectionRequestId: string;
  inspectionRequestCode: string | null;
  quotationId: string | null;
  status: BookingStatus;
  requestType: InspectionRequestType;
  serviceId: string | null;
  serviceName: string | null;
  serviceBusinessType: string | null;
  customRequest: { title: string; description: string } | null;
  customer: InspectionCustomer;
  customerId: string | null;
  address: InspectionAddress;
  scheduledSlot: InspectionSlot | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  estimatedDurationMinutes: number | null;
  assignedTo: InspectionAssignment | null;
  ownerNote: string | null;
  quotation: InspectionQuotationSummary | null;
  createdAt: number | null;
  updatedAt: number | null;
};
