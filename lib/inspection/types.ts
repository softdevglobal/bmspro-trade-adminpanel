/**
 * Shared types and helpers for inspection visit requests.
 *
 * Customers submit requests from /booknow/[slug] and business owners
 * triage them in /dashboard/inspection-visits.
 */

export const INSPECTION_COLLECTION = "inspection_requests";

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
  "cancelled",
  "completed",
] as const;
export type InspectionRequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<InspectionRequestStatus, string> = {
  pending: "Pending review",
  owner_proposed: "Awaiting customer",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  completed: "Completed",
};

/** Each preferred or proposed slot — date plus a coarse time range. */
export type InspectionSlot = {
  date: string; // YYYY-MM-DD
  timeRange: InspectionTimeRange;
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
  address: InspectionAddress;
  preferredSlots: InspectionSlot[];
  ownerProposedSlots: InspectionSlot[];
  scheduledSlot: InspectionSlot | null;
  /** Specific visit window the owner sets when confirming, e.g. 10:00–11:00. */
  scheduledStartTime: string | null; // "HH:MM" 24h
  scheduledEndTime: string | null; // "HH:MM" 24h
  assignedTo: InspectionAssignment | null;
  ownerNote: string | null;
  customerNotes: string | null;
  budgetAud: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  visitStartedAt: number | null;
};

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

export function isFutureOrTodayDate(value: string): boolean {
  if (!isIsoDate(value)) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return value >= todayIso;
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

function parseSlot(raw: unknown): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = trimString(item.date);
  const timeRange = item.timeRange;
  if (!isFutureOrTodayDate(date)) return null;
  if (!isTimeRange(timeRange)) return null;
  return { date, timeRange };
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

export function parseSlotsArray(raw: unknown, max = 3): InspectionSlot[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map(parseSlot)
    .filter((slot): slot is InspectionSlot => slot !== null);
  return dedupeSlots(parsed).slice(0, max);
}

/** Validates and normalises a raw payload from the booking page. */
export function parseInspectionRequestInput(raw: unknown):
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

  const preferredSlots = parseSlotsArray(input.preferredSlots, 3);
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
    },
  };
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

export function formatSlotDate(date: string): string {
  if (!isIsoDate(date)) return date;
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
