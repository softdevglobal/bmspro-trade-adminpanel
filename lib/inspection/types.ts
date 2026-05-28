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
  address: InspectionAddress;
  preferredSlots: InspectionSlot[];
  ownerProposedSlots: InspectionSlot[];
  scheduledSlot: InspectionSlot | null;
  assignedTo: InspectionAssignment | null;
  ownerNote: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
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

  return {
    ok: true,
    value: {
      requestType,
      serviceId,
      customRequest,
      customer: { fullName, email, phone },
      address,
      preferredSlots,
    },
  };
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
  return [address.street, address.suburb, address.state, address.postcode]
    .filter((part) => part.trim().length > 0)
    .join(", ");
}
