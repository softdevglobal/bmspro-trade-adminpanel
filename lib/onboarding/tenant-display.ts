import { AU_TIMEZONES } from "@/lib/onboarding/types";

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
  if (!timezoneId) return "—";
  const match = AU_TIMEZONES.find((tz) => tz.id === timezoneId);
  return match?.label ?? timezoneId;
}

export function formatTenantDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
