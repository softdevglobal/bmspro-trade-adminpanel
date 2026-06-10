export const BUSINESS_TYPES = [
  { id: "Plumbing", icon: "plumbing" },
  { id: "Electrical", icon: "electrical_services" },
  { id: "HVAC", icon: "ac_unit" },
  { id: "Gas Fitting", icon: "propane_tank" },
  { id: "Cleaning", icon: "cleaning_services" },
  { id: "Landscaping", icon: "yard" },
  { id: "Carpentry", icon: "carpenter" },
  { id: "Other", icon: "more_horiz" },
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number]["id"];

/** Trades offered when creating service templates (Electrical excluded). */
export const SERVICE_TEMPLATE_TRADES = BUSINESS_TYPES.filter(
  (type) => type.id !== "Electrical"
);

export type ServiceTemplateTrade = (typeof SERVICE_TEMPLATE_TRADES)[number]["id"];

export const BUSINESS_STRUCTURES = [
  { id: "Pty Ltd", icon: "corporate_fare" },
  { id: "Sole Trader", icon: "person" },
  { id: "Partnership", icon: "handshake" },
  { id: "Trust", icon: "shield" },
] as const;

export type BusinessStructure = (typeof BUSINESS_STRUCTURES)[number]["id"];

export const AU_STATES = [
  { id: "NSW", label: "NSW — New South Wales" },
  { id: "VIC", label: "VIC — Victoria" },
  { id: "QLD", label: "QLD — Queensland" },
  { id: "SA", label: "SA — South Australia" },
  { id: "WA", label: "WA — Western Australia" },
  { id: "TAS", label: "TAS — Tasmania" },
  { id: "NT", label: "NT — Northern Territory" },
  { id: "ACT", label: "ACT — Australian Capital Territory" },
] as const;

export type AuState = (typeof AU_STATES)[number]["id"];

export const AU_TIMEZONES = [
  { id: "Australia/Sydney", label: "Sydney (NSW) — AEST/AEDT" },
  { id: "Australia/Melbourne", label: "Melbourne (VIC) — AEST/AEDT" },
  { id: "Australia/Brisbane", label: "Brisbane (QLD) — AEST" },
  { id: "Australia/Adelaide", label: "Adelaide (SA) — ACST/ACDT" },
  { id: "Australia/Perth", label: "Perth (WA) — AWST" },
  { id: "Australia/Hobart", label: "Hobart (TAS) — AEST/AEDT" },
  { id: "Australia/Darwin", label: "Darwin (NT) — ACST" },
] as const;

export type AuTimezone = (typeof AU_TIMEZONES)[number]["id"];

export const SUBSCRIPTION_PLANS = [
  {
    id: "booking_management",
    name: "Job Management",
    price: 299,
    period: "7-day",
    billingNote: "Weekly • 7-day renewal",
    branches: 1,
    staff: 5,
    trialDays: null as number | null,
    description:
      "Jobs, calendar, customers, staff assignment and job tracking for your trade business.",
  },
  {
    id: "trade_pro",
    name: "Trade Pro",
    price: 399,
    period: "7-day",
    billingNote: "Weekly • 7-day renewal",
    branches: 1,
    staff: 5,
    trialDays: 7,
    description:
      "Everything in Job Management plus quotes, invoices, contractor connections and partner jobs.",
  },
  {
    id: "trade_pro_front_desk",
    name: "Trade Pro + Front Desk",
    price: 399,
    period: "7-day",
    billingNote: "Weekly • 7-day renewal",
    branches: 1,
    staff: 5,
    trialDays: 14,
    description:
      "Includes reception service and trade software — we answer calls, make bookings, get work approvals, and give you the system to manage jobs, staff and daily activity.",
  },
] as const;

export type PlanId = (typeof SUBSCRIPTION_PLANS)[number]["id"];

export type OnboardingPayload = {
  businessType: BusinessType;
  businessName: string;
  abn: string;
  businessStructure: BusinessStructure;
  registeredForGst: boolean;
  businessAddress: string;
  state: AuState;
  postcode: string;
  timezone: AuTimezone;
  businessPhone: string;
  ownerFullName: string;
  accountEmail: string;
  password?: string;
  confirmPassword?: string;
  selectedPlanId: PlanId;
  serviceAreas: string[];
  /** Optional public HTTPS URL of the uploaded business logo. */
  logoUrl?: string | null;
};

export const MAX_SERVICE_AREAS = 20;
export const MIN_SERVICE_AREAS = 1;

/**
 * Title-case a service area string while preserving digits (postcodes).
 * "south melbourne 3205" -> "South Melbourne 3205".
 * Each word's first letter is capitalised; numbers and existing capitals
 * inside the same token are left alone.
 */
export function titleCaseServiceArea(value: string): string {
  if (!value) return value;
  return value.replace(/(^|[\s\-/])([a-z])/g, (_, sep, ch: string) =>
    sep + ch.toUpperCase()
  );
}

/** Strip blanks, trim, and title-case each entry. */
export function normaliseServiceAreas(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const cased = titleCaseServiceArea(trimmed);
    const key = cased.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cased);
  }
  return out.slice(0, MAX_SERVICE_AREAS);
}

export type TenantStatus = "pending_review" | "active" | "suspended";

export type TenantSource = "self_signup" | "super_admin_create";

/** Default login password when a super admin onboard a business owner. */
export const ADMIN_CREATED_DEFAULT_PASSWORD = "00001111";

export function iconForBusinessType(type: string): string {
  const found = BUSINESS_TYPES.find((b) => b.id === type);
  return found?.icon ?? "store";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string): boolean {
  return /^\+?[\d\s()-]{6,}$/.test(value);
}

export function validateBusinessStep(
  payload: Partial<OnboardingPayload>
): { ok: true } | { ok: false; error: string } {
  const businessName = (payload.businessName ?? "").trim();
  const businessPhone = (payload.businessPhone ?? "").trim();
  const state = payload.state;
  const postcode = (payload.postcode ?? "").trim();
  const timezone = payload.timezone;
  const businessType = payload.businessType;
  const businessStructure = payload.businessStructure;

  if (businessName.length < 2) {
    return { ok: false, error: "Please enter your business name." };
  }
  if (!businessType || !BUSINESS_TYPES.some((b) => b.id === businessType)) {
    return { ok: false, error: "Please select a business type." };
  }
  if (
    !businessStructure ||
    !BUSINESS_STRUCTURES.some((b) => b.id === businessStructure)
  ) {
    return { ok: false, error: "Please select a business structure." };
  }
  if (!state || !AU_STATES.some((s) => s.id === state)) {
    return { ok: false, error: "Please select a state." };
  }
  if (!/^\d{4}$/.test(postcode)) {
    return { ok: false, error: "Please enter a valid 4-digit postcode." };
  }
  if (!timezone || !AU_TIMEZONES.some((t) => t.id === timezone)) {
    return { ok: false, error: "Please select a timezone." };
  }
  if (!isValidPhone(businessPhone)) {
    return { ok: false, error: "Please enter a valid business phone number." };
  }

  const serviceAreas = normaliseServiceAreas(payload.serviceAreas);
  if (serviceAreas.length < MIN_SERVICE_AREAS) {
    return {
      ok: false,
      error: "Add at least one service area you cover.",
    };
  }
  if (serviceAreas.some((a) => a.length < 2)) {
    return {
      ok: false,
      error: "Each service area must be at least 2 characters.",
    };
  }

  return { ok: true };
}

export function validateAccountStep(
  payload: Partial<OnboardingPayload>,
  options: { requirePassword: boolean }
): { ok: true } | { ok: false; error: string } {
  const accountEmail = (payload.accountEmail ?? "").trim().toLowerCase();
  const ownerFullName = (payload.ownerFullName ?? "").trim();

  if (ownerFullName.length < 2) {
    return { ok: false, error: "Please enter your full name." };
  }

  if (!isValidEmail(accountEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  if (options.requirePassword) {
    const password = payload.password ?? "";
    const confirmPassword = payload.confirmPassword ?? "";

    if (password.length < 8) {
      return {
        ok: false,
        error: "Password must be at least 8 characters.",
      };
    }
    if (password !== confirmPassword) {
      return { ok: false, error: "Passwords do not match." };
    }
  }

  return { ok: true };
}

export function validatePlanStep(
  payload: Partial<OnboardingPayload>
): { ok: true } | { ok: false; error: string } {
  const planId = payload.selectedPlanId;
  if (!planId || !SUBSCRIPTION_PLANS.some((p) => p.id === planId)) {
    return { ok: false, error: "Please select a subscription plan." };
  }
  return { ok: true };
}

export function validateOnboardingPayload(
  payload: Partial<OnboardingPayload>,
  options: { requirePassword: boolean }
): { ok: true; value: OnboardingPayload } | { ok: false; error: string } {
  const business = validateBusinessStep(payload);
  if (!business.ok) return business;

  const account = validateAccountStep(payload, options);
  if (!account.ok) return account;

  const plan = validatePlanStep(payload);
  if (!plan.ok) return plan;

  const value: OnboardingPayload = {
    businessType: payload.businessType as BusinessType,
    businessName: (payload.businessName ?? "").trim(),
    abn: (payload.abn ?? "").trim(),
    businessStructure: payload.businessStructure as BusinessStructure,
    registeredForGst: Boolean(payload.registeredForGst),
    businessAddress: (payload.businessAddress ?? "").trim(),
    state: payload.state as AuState,
    postcode: (payload.postcode ?? "").trim(),
    timezone: payload.timezone as AuTimezone,
    businessPhone: (payload.businessPhone ?? "").trim(),
    ownerFullName: (payload.ownerFullName ?? "").trim(),
    accountEmail: (payload.accountEmail ?? "").trim().toLowerCase(),
    selectedPlanId: payload.selectedPlanId as PlanId,
    serviceAreas: normaliseServiceAreas(payload.serviceAreas),
    logoUrl:
      typeof payload.logoUrl === "string" && payload.logoUrl.trim()
        ? payload.logoUrl.trim()
        : null,
  };

  if (options.requirePassword) {
    value.password = payload.password;
    value.confirmPassword = payload.confirmPassword;
  }

  return { ok: true, value };
}

export function formatAbn(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

export function passwordStrength(
  password: string
): "weak" | "fair" | "good" | "strong" {
  if (password.length === 0) return "weak";
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return "weak";
  if (score === 2) return "fair";
  if (score === 3) return "good";
  return "strong";
}
