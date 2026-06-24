import { AU_TIMEZONES } from "@/lib/onboarding/types";
import type { BusinessModuleSettings } from "@/lib/business/module-settings";
import {
  formatInPlatformTimeZone,
  PLATFORM_TIME_ZONE,
} from "@/lib/platform/timezone";

export type TenantPlan = {
  name: string;
  price: number;
  period: string;
  trialDays: number | null;
};

export type TenantOwner = {
  fullName: string | null;
  email: string | null;
};

export type TenantDetail = {
  /** Internal key only — never shown in the UI */
  id: string;
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessType: string;
  abn: string | null;
  businessStructure: string | null;
  registeredForGst: boolean;
  businessAddress: string | null;
  state: string;
  postcode: string;
  timezone: string | null;
  mainSuburb: string;
  serviceAreas: string[];
  bookingSlug: string | null;
  bookingPath: string | null;
  plan: TenantPlan | null;
  status: "pending_review" | "active" | "suspended";
  source: "self_signup" | "super_admin_create";
  isActive: boolean;
  onboardingProgress: number | null;
  onboardingStep: string | null;
  owner: TenantOwner | null;
  createdAt: number | null;
  updatedAt: number | null;
  enabledModules: BusinessModuleSettings;
};

export function timezoneLabel(timezoneId: string | null): string {
  const effectiveTimezone = timezoneId || PLATFORM_TIME_ZONE;
  const match = AU_TIMEZONES.find((tz) => tz.id === effectiveTimezone);
  return match?.label ?? effectiveTimezone;
}

/** Super-admin audit log timestamps always use Melbourne time. */
export const SUPER_ADMIN_AUDIT_TIMEZONE = "Australia/Melbourne";

const DEFAULT_AUDIT_TIMEZONE = "Australia/Sydney";

const auditDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function auditDateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = auditDateTimeFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    auditDateTimeFormatters.set(timezone, formatter);
  }
  return formatter;
}

export function isKnownAuTimezone(
  timezoneId: string | null | undefined,
): timezoneId is (typeof AU_TIMEZONES)[number]["id"] {
  return Boolean(
    timezoneId && AU_TIMEZONES.some((timezone) => timezone.id === timezoneId),
  );
}

export function resolveAuditDisplayTimezone(
  scope: "platform" | "tenant" | "customer",
  businessTimezone: string | null | undefined,
): string {
  if (scope === "platform") return SUPER_ADMIN_AUDIT_TIMEZONE;
  if (isKnownAuTimezone(businessTimezone)) return businessTimezone;
  return DEFAULT_AUDIT_TIMEZONE;
}

export function formatAuditDateTime(
  millis: number | null,
  timezone: string,
): string {
  if (!millis) return "—";
  return auditDateTimeFormatter(timezone).format(new Date(millis));
}

export function formatTenantDate(ms: number | null): string {
  if (!ms) return "—";
  return formatInPlatformTimeZone(ms, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
