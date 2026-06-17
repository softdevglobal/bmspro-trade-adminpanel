import type {
  InspectionAddress,
  InspectionAssignment,
  InspectionCustomer,
  InspectionQuotationSummary,
  InspectionRequestType,
  InspectionSlot,
} from "@/lib/inspection/types";

export const JOBS_COLLECTION = "jobs";

export const BOOKING_STATUSES = [
  "awaiting",
  "scheduled",
  "ongoing",
  "cancelled",
  "completed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  awaiting: "Awaiting job",
  scheduled: "Scheduled",
  ongoing: "Ongoing",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const BOOKING_STATUS_TONE: Record<BookingStatus, string> = {
  awaiting:
    "bg-orange-50 text-orange-800 border border-orange-200",
  scheduled:
    "bg-emerald-50 text-emerald-700 border border-emerald-200",
  ongoing: "bg-amber-50 text-amber-800 border border-amber-200",
  cancelled:
    "bg-stone-100 text-stone-600 border border-stone-200",
  completed: "bg-sky-50 text-sky-700 border border-sky-200",
};

export function parseBookingStatus(raw: unknown): BookingStatus | null {
  if (typeof raw !== "string") return null;
  if (raw === "await") return "awaiting";
  if ((BOOKING_STATUSES as readonly string[]).includes(raw)) {
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
  visitStartedAt: number | null;
  visitEndedAt: number | null;
  bookingStartedAt: number | null;
  /** Auto-completed booking created when a quotation is invoiced without a job visit. */
  completedFromInvoice: boolean;
  /** Optional photos captured before work started. */
  beforeImageUrls: string[];
  /** Optional photos captured after work finished. */
  afterImageUrls: string[];
  createdAt: number | null;
  updatedAt: number | null;
};
