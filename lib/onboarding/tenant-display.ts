import { AU_TIMEZONES } from "@/lib/onboarding/types";
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
};

export function timezoneLabel(timezoneId: string | null): string {
  const effectiveTimezone = timezoneId || PLATFORM_TIME_ZONE;
  const match = AU_TIMEZONES.find((tz) => tz.id === effectiveTimezone);
  return match?.label ?? effectiveTimezone;
}

export function formatTenantDate(ms: number | null): string {
  if (!ms) return "—";
  return formatInPlatformTimeZone(ms, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
