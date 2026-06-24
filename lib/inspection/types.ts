/**
 * Shared types and helpers for service requests.
 *
 * Customers submit requests from /booknow/[slug] and business owners
 * triage them in /dashboard/requests.
 */

import type { BookingStatus } from "@/lib/bookings/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  formatIsoDateInPlatformTimeZone,
  platformTodayIso,
} from "@/lib/platform/timezone";
import { legacyInspectionReferenceFromId } from "@/lib/reference-codes";

export const REQUESTS_COLLECTION = "requests";

export const REQUEST_TYPES = ["existing_service", "custom_quote"] as const;
export type InspectionRequestType = (typeof REQUEST_TYPES)[number];

export const TIME_RANGES = ["morning", "afternoon"] as const;
export type InspectionTimeRange = (typeof TIME_RANGES)[number];

export const TIME_RANGE_LABELS: Record<InspectionTimeRange, string> = {
  morning: "Morning (8am – 12pm)",
  afternoon: "Afternoon (12pm – 5pm)",
};

export const TIME_RANGE_SHORT_LABELS: Record<InspectionTimeRange, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
};

export const REQUEST_STATUSES = [
  "pending",
  "owner_proposed",
  "scheduled",
  "awaiting_decision",
  "cancelled",
  "completed",
] as const;
export type InspectionRequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<InspectionRequestStatus, string> = {
  pending: "Pending review",
  owner_proposed: "Awaiting customer",
  scheduled: "Scheduled",
  awaiting_decision: "Awaiting decision",
  cancelled: "Cancelled",
  completed: "Completed",
};

/** Morning vs afternoon from a 24h start time (for job booking slots). */
export function timeRangeFromStartTime(startTime: string): InspectionTimeRange {
  const hour = Number.parseInt(startTime.split(":")[0] ?? "", 10);
  if (!Number.isFinite(hour)) return "morning";
  return hour < 12 ? "morning" : "afternoon";
}

/** Where a new requests document was created. */
export const INSPECTION_CREATED_SOURCES = [
  "booking_engine",
  "owner_dashboard",
  "owner_mobile",
  "quotation_direct",
  "invoice_direct",
  "job_direct",
] as const;
export type InspectionRequestCreatedSource =
  (typeof INSPECTION_CREATED_SOURCES)[number];

export const CREATED_SOURCE_LABELS: Record<
  InspectionRequestCreatedSource,
  string
> = {
  booking_engine: "Booking engine",
  owner_dashboard: "Admin panel",
  owner_mobile: "Mobile app",
  quotation_direct: "Quotation",
  invoice_direct: "Invoice",
  job_direct: "Direct job",
};

export function isCreatedSource(
  value: unknown,
): value is InspectionRequestCreatedSource {
  return (
    typeof value === "string" &&
    (INSPECTION_CREATED_SOURCES as readonly string[]).includes(value)
  );
}

export function parseCreatedSource(
  raw: unknown,
): InspectionRequestCreatedSource | null {
  if (raw === "booking") return "booking_engine";
  return isCreatedSource(raw) ? raw : null;
}

/** Each preferred or proposed slot — date plus session and optional hour window. */
export type InspectionSlot = {
  date: string; // YYYY-MM-DD
  timeRange: InspectionTimeRange;
  startTime?: string | null;
  endTime?: string | null;
};

export type InspectionAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

export type InspectionCustomer = {
  fullName: string;
  email: string;
  phone: string;
};

export type InspectionAssignment = {
  type: "staff" | "owner";
  uid: string;
  name: string;
  email: string | null;
};

export type InspectionRequestInput = {
  requestType: InspectionRequestType;
  serviceId: string | null;
  customRequest: { title: string; description: string } | null;
  customer: InspectionCustomer;
  address: InspectionAddress;
  preferredSlots: InspectionSlot[];
  /** Optional extra context from the customer (step 1). */
  customerNotes: string | null;
  /** Optional budget in Australian dollars. */
  budgetAud: number | null;
  /** Optional photos uploaded by the customer when placing the request. */
  customerImageUrls: string[];
};

/** Detail returned by the API and rendered in the admin UI. */
export type InspectionRequestDetail = {
  id: string;
  businessId: string;
  status: InspectionRequestStatus;
  requestType: InspectionRequestType;
  serviceId: string | null;
  serviceName: string | null;
  serviceBusinessType: string | null;
  customRequest: { title: string; description: string } | null;
  customer: InspectionCustomer;
  customerId: string | null;
  /** Set on create; null on older documents. */
  createdSource: InspectionRequestCreatedSource | null;
  /** Human-readable code, e.g. `INS-REQ 4K7H2M9P`. Null on older documents. */
  requestCode: string | null;
  address: InspectionAddress;
  preferredSlots: InspectionSlot[];
  ownerProposedSlots: InspectionSlot[];
  /** Up to 3 job days the customer picks when accepting a quotation. */
  jobPreferredSlots: InspectionSlot[];
  /** Admin-editable alternative job days when customer dates do not work. */
  adminJobPreferredSlots: InspectionSlot[];
  /** Job days proposed to the customer when their choices do not work. */
  jobProposedSlots: InspectionSlot[];
  /** Customer's pick from `jobProposedSlots` (null until they accept one). */
  customerAcceptedJobSlot: InspectionSlot | null;
  scheduledSlot: InspectionSlot | null;
  /** Specific visit window the owner sets when confirming, e.g. 10:00–11:00. */
  scheduledStartTime: string | null; // "HH:MM" 24h
  scheduledEndTime: string | null; // "HH:MM" 24h
  assignedTo: InspectionAssignment | null;
  ownerNote: string | null;
  customerNotes: string | null;
  budgetAud: number | null;
  customerImageUrls: string[];
  createdAt: number | null;
  updatedAt: number | null;
  visitStartedAt: number | null;
  visitEndedAt: number | null;
  /** Summary mirrored from quotations when a quote is sent. */
  quotation: InspectionQuotationSummary | null;
  /** Summary mirrored from invoices when an invoice is issued (id = quotation id). */
  invoice: InspectionInvoiceSummary | null;
  /** Linked job booking document id (`bookings` collection). */
  bookingId: string | null;
  /** Human-readable job code, e.g. `BK 4K7H2M9P`. */
  bookingCode: string | null;
  /** Booking follow-up state (e.g. awaiting customer decision before a job exists). */
  bookingStatus: BookingStatus | null;
  /** When `bookingStatus` was last set or changed. */
  bookingStatusAt: number | null;
  /** @deprecated Job duration lives on `bookings`; kept for older documents. */
  estimatedDurationMinutes: number | null;
  /** Millis when a job booking was created from this visit. */
  bookingConfirmedAt: number | null;
};

/** Customer's response to a sent quotation. */
export type QuotationCustomerDecision = "accepted" | "rejected";

export function parseQuotationCustomerDecision(
  raw: unknown,
): QuotationCustomerDecision | null {
  return raw === "accepted" || raw === "rejected" ? raw : null;
}

/** Quotation summary stored on requests after a quote is created. */
export type InspectionQuotationSummary = {
  id: string;
  quotationCode: string | null;
  pdfUrl: string | null;
  finalPriceAud: number | null;
  subtotalAud: number | null;
  balanceDueAud: number | null;
  status: string | null;
  createdAt: number | null;
  /** Customer accept/reject response (null until the customer decides). */
  customerDecision: QuotationCustomerDecision | null;
  customerDecisionAt: number | null;
};

/** Invoice summary stored on requests after an invoice is issued. */
export type InspectionInvoiceSummary = {
  id: string;
  invoiceCode: string | null;
  pdfUrl: string | null;
  finalPriceAud: number | null;
  balanceDueAud: number | null;
  status: "draft" | "sent" | "paid" | null;
  invoiceDate: string | null;
  dueDate: string | null;
};

export function parseInspectionInvoice(
  raw: unknown,
): InspectionInvoiceSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return null;

  const readPrice = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const pdfUrlRaw = typeof item.pdfUrl === "string" ? item.pdfUrl.trim() : "";
  const statusRaw = item.status;

  return {
    id,
    invoiceCode:
      typeof item.invoiceCode === "string" && item.invoiceCode.trim()
        ? item.invoiceCode.trim()
        : null,
    pdfUrl: pdfUrlRaw.length > 0 ? pdfUrlRaw : null,
    finalPriceAud: readPrice(item.finalPriceAud),
    balanceDueAud: readPrice(item.balanceDueAud),
    status:
      statusRaw === "paid"
        ? "paid"
        : statusRaw === "sent"
          ? "sent"
          : statusRaw === "draft"
            ? "draft"
            : null,
    invoiceDate:
      typeof item.invoiceDate === "string" && item.invoiceDate.trim()
        ? item.invoiceDate.trim()
        : null,
    dueDate:
      typeof item.dueDate === "string" && item.dueDate.trim()
        ? item.dueDate.trim()
        : null,
  };
}

export function parseInspectionQuotation(
  raw: unknown,
): InspectionQuotationSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return null;

  const readPrice = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const pdfUrlRaw = typeof item.pdfUrl === "string" ? item.pdfUrl.trim() : "";

  const quotationCode =
    typeof item.quotationCode === "string" && item.quotationCode.trim()
      ? item.quotationCode.trim()
      : null;

  return {
    id,
    quotationCode,
    pdfUrl: pdfUrlRaw.length > 0 ? pdfUrlRaw : null,
    finalPriceAud: readPrice(item.finalPriceAud),
    subtotalAud: readPrice(item.subtotalAud),
    balanceDueAud: readPrice(item.balanceDueAud),
    status: typeof item.status === "string" ? item.status : null,
    createdAt: toMillis(item.createdAt),
    customerDecision: parseQuotationCustomerDecision(item.customerDecision),
    customerDecisionAt: toMillis(item.customerDecisionAt),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse YYYY-MM-DD as a local calendar date (avoids UTC day-shift bugs). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

export function isFutureOrTodayDate(
  value: string,
  timeZone?: string | null,
): boolean {
  if (!isIsoDate(value)) return false;
  return value >= platformTodayIso(new Date(), timeZone);
}

export function isTimeRange(value: unknown): value is InspectionTimeRange {
  return TIME_RANGES.includes(value as InspectionTimeRange);
}

export function isRequestType(value: unknown): value is InspectionRequestType {
  return REQUEST_TYPES.includes(value as InspectionRequestType);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function digitsOnly(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function parseSlot(raw: unknown, timeZone?: string | null): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = trimString(item.date);
  const timeRange = item.timeRange;
  if (!isFutureOrTodayDate(date, timeZone)) return null;
  if (!isTimeRange(timeRange)) return null;
  const startTime = isClockTime(item.startTime) ? item.startTime : null;
  const endTime = isClockTime(item.endTime) ? item.endTime : null;
  return {
    date,
    timeRange,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  };
}

function dedupeSlots(slots: InspectionSlot[]): InspectionSlot[] {
  const seen = new Set<string>();
  const result: InspectionSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.date}__${slot.timeRange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slot);
  }
  return result;
}

export function parseSlotsArray(
  raw: unknown,
  max = 3,
  timeZone?: string | null,
): InspectionSlot[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((slot) => parseSlot(slot, timeZone))
    .filter((slot): slot is InspectionSlot => slot !== null);
  return dedupeSlots(parsed).slice(0, max);
}

/** Validates job-day preferences (exactly 3 unique dates when accepting a quote). */
export function validateJobPreferredSlotsForAcceptance(
  raw: unknown,
  timeZone?: string | null,
): { ok: true; value: InspectionSlot[] } | { ok: false; error: string } {
  const slots = parseSlotsArray(raw, 3, timeZone);
  if (slots.length !== 3) {
    return {
      ok: false,
      error: "Pick exactly 3 preferred job days before accepting.",
    };
  }
  const uniqueDates = new Set(slots.map((slot) => slot.date));
  if (uniqueDates.size !== 3) {
    return {
      ok: false,
      error: "Each preferred job day must be a different date.",
    };
  }
  return { ok: true, value: slots };
}

/** Validates admin-editable alternative job days (1–3 unique dates). */
export function validateAdminJobPreferredSlots(
  raw: unknown,
  timeZone?: string | null,
): { ok: true; value: InspectionSlot[] } | { ok: false; error: string } {
  const slots = parseSlotsArray(raw, 3, timeZone);
  if (slots.length === 0) {
    return { ok: false, error: "Pick at least one alternative job day." };
  }
  const uniqueDates = new Set(slots.map((slot) => slot.date));
  if (uniqueDates.size !== slots.length) {
    return {
      ok: false,
      error: "Each alternative job day must be a different date.",
    };
  }
  return { ok: true, value: slots };
}

type JobDateProposalContext = Pick<
  InspectionRequestDetail,
  | "quotation"
  | "bookingId"
  | "jobPreferredSlots"
  | "jobProposedSlots"
  | "customerAcceptedJobSlot"
>;

/** Customer accepted the quote and sent job days; admin may propose alternatives. */
export function canAdminProposeJobDates(
  request: JobDateProposalContext,
): boolean {
  return (
    !!request.quotation &&
    request.quotation.status !== "cancelled" &&
    request.quotation.customerDecision === "accepted" &&
    !request.bookingId &&
    request.jobPreferredSlots.length > 0 &&
    !request.customerAcceptedJobSlot
  );
}

/** Customer sent job days but admin has not proposed alternatives yet. */
export function needsAdminJobDateProposal(
  request: JobDateProposalContext,
): boolean {
  return (
    canAdminProposeJobDates(request) && request.jobProposedSlots.length === 0
  );
}

/** Validates and normalises a raw payload from the booking page. */
export function parseInspectionRequestInput(
  raw: unknown,
  timeZone?: string | null,
):
  | { ok: true; value: InspectionRequestInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const requestType = input.requestType;
  if (!isRequestType(requestType)) {
    return { ok: false, error: "Choose a request type." };
  }

  const customerRaw = (input.customer ?? {}) as Record<string, unknown>;
  const fullName = trimString(customerRaw.fullName);
  const email = trimString(customerRaw.email).toLowerCase();
  const phone = digitsOnly(customerRaw.phone);

  if (!fullName) return { ok: false, error: "Your name is required." };
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!phone) return { ok: false, error: "Mobile number is required." };

  const addressRaw = (input.address ?? {}) as Record<string, unknown>;
  const address: InspectionAddress = {
    street: trimString(addressRaw.street),
    suburb: trimString(addressRaw.suburb),
    state: trimString(addressRaw.state),
    postcode: trimString(addressRaw.postcode),
  };

  if (
    address.street.length < 3 ||
    address.suburb.length < 2 ||
    address.state.length < 2 ||
    address.postcode.length < 3
  ) {
    return { ok: false, error: "Service address must be complete." };
  }

  let serviceId: string | null = null;
  let customRequest: { title: string; description: string } | null = null;

  if (requestType === "existing_service") {
    const id = trimString(input.serviceId);
    if (!id) {
      return { ok: false, error: "Choose a service to request." };
    }
    serviceId = id;
  } else {
    const titleRaw = (input.customRequest ?? {}) as Record<string, unknown>;
    const title = trimString(titleRaw.title);
    const description = trimString(titleRaw.description);
    if (title.length < 3) {
      return { ok: false, error: "Add a short title for the work needed." };
    }
    if (description.length < 10) {
      return {
        ok: false,
        error: "Describe the work needed in a bit more detail.",
      };
    }
    customRequest = { title, description };
  }

  const preferredSlots = parseSlotsArray(input.preferredSlots, 3, timeZone);
  if (preferredSlots.length === 0) {
    return {
      ok: false,
      error: "Pick at least one preferred date and time range.",
    };
  }

  const customerNotes = trimString(input.customerNotes);
  if (customerNotes.length > 2000) {
    return { ok: false, error: "Notes must be 2000 characters or fewer." };
  }

  const budgetParsed = parseBudgetAudInput(input.budgetAud);
  if (!budgetParsed.ok) {
    return { ok: false, error: budgetParsed.error };
  }

  const customerImageUrls = parseCustomerImageUrls(input.customerImageUrls);

  return {
    ok: true,
    value: {
      requestType,
      serviceId,
      customRequest,
      customer: { fullName, email, phone },
      address,
      preferredSlots,
      customerNotes: customerNotes || null,
      budgetAud: budgetParsed.value,
      customerImageUrls,
    },
  };
}

const MAX_CUSTOMER_BOOKING_IMAGES = 5;

/** Parses optional customer photo URLs from the booking portal. */
export function parseCustomerImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const url = entry.trim();
    if (!url.startsWith("https://") || url.length > 2048) continue;
    result.push(url);
    if (result.length >= MAX_CUSTOMER_BOOKING_IMAGES) break;
  }
  return result;
}

/** Parses optional budget from form/API (AUD). Empty is allowed. */
export function parseBudgetAudInput(
  raw: unknown,
):
  | { ok: true; value: number | null }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (!trimmed) return { ok: true, value: null };

  const cleaned = trimmed.replace(/[^\d.]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: "Enter a valid budget amount." };
  }
  if (num > 99_999_999) {
    return { ok: false, error: "Budget amount is too large." };
  }
  return { ok: true, value: Math.round(num * 100) / 100 };
}

/** Display budget as `Aus $12,500` (booking + admin UI). */
export function formatBudgetAud(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return null;
  }
  const formatted = new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  return `Aus $${formatted}`;
}

export function formatSlotDate(date: string, timeZone?: string | null): string {
  if (!isIsoDate(date)) return date;
  return formatIsoDateInPlatformTimeZone(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }, timeZone);
}

/** @deprecated Prefer `displayInspectionRequestCode` from `@/lib/reference-codes`. */
export function formatInspectionVisitReference(
  inspectionRequestId: string,
): string {
  return legacyInspectionReferenceFromId(inspectionRequestId);
}

export function formatAddress(address: InspectionAddress): string {
  const postcode = address.postcode.trim();
  const parts = [address.street, address.suburb, address.state]
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== postcode);

  if (postcode) {
    const joined = parts.join(", ");
    const alreadyIncluded =
      parts.some((part) => part === postcode) ||
      new RegExp(`\\b${escapeRegExp(postcode)}\\b`).test(joined);
    if (!alreadyIncluded) parts.push(postcode);
  }

  return parts.join(", ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates an `HH:MM` (24h) clock time string. */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_TIME.test(value.trim());
}

/** Formats `HH:MM` (24h) as a friendly `10:00 AM`. Returns null if invalid. */
export function formatClockTime(value: string | null | undefined): string | null {
  if (!isClockTime(value)) return null;
  const [hourStr, minuteStr] = value.trim().split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minutePart = minute === 0 ? "" : `:${minuteStr}`;
  return `${hour12}${minutePart} ${period}`;
}

/**
 * Formats a visit window from two `HH:MM` values into `10:00 AM – 11:00 AM`.
 * Returns null when no usable window is available.
 */
export function formatVisitWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const startLabel = formatClockTime(start);
  const endLabel = formatClockTime(end);
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  if (startLabel) return `From ${startLabel}`;
  if (endLabel) return `Until ${endLabel}`;
  return null;
}

const DEFAULT_SLOT_START: Record<InspectionTimeRange, string> = {
  morning: "10:00",
  afternoon: "13:00",
};

/** Resolve the sortable start time for a slot (hourly window or session default). */
export function resolveSlotStartTime(slot: InspectionSlot): string {
  if (slot.startTime && isClockTime(slot.startTime)) return slot.startTime.trim();
  return DEFAULT_SLOT_START[slot.timeRange];
}

/** Compare slots by date, then hourly start time. */
export function compareInspectionSlots(
  a: InspectionSlot,
  b: InspectionSlot,
): number {
  const dateCmp = a.date.localeCompare(b.date);
  if (dateCmp !== 0) return dateCmp;
  const aMin = parseClockMinutes(resolveSlotStartTime(a)) ?? 0;
  const bMin = parseClockMinutes(resolveSlotStartTime(b)) ?? 0;
  if (aMin !== bMin) return aMin - bMin;
  return a.timeRange.localeCompare(b.timeRange);
}

/** Sort slots in calendar time order (date, then start time). */
export function sortInspectionSlots<T extends InspectionSlot>(
  slots: readonly T[],
): T[] {
  return [...slots].sort(compareInspectionSlots);
}

export const UNSCHEDULED_SORT_KEY = "9999-12-31T23:59";

/** Sort key for confirmed inspection visits only (not preferred slots). */
export function inspectionRequestScheduleSortKey(
  request: InspectionRequestDetail,
): string {
  if (request.scheduledSlot?.date) {
    const start =
      request.scheduledStartTime && isClockTime(request.scheduledStartTime)
        ? request.scheduledStartTime
        : resolveSlotStartTime(request.scheduledSlot);
    return `${request.scheduledSlot.date}T${start}`;
  }
  return UNSCHEDULED_SORT_KEY;
}
