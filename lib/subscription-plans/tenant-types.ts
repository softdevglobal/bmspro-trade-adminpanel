import type { SubscriptionPlanDisplay } from "@/lib/subscription-plans/display";

export type PlanChangeDirection = "upgrade" | "downgrade" | "same";

export type BundledSmsSnapshot = {
  id: string;
  name: string;
  messageQuota: number;
  priceLabel: string;
} | null;

export type TenantSubscriptionSnapshot = {
  planId: string | null;
  planName: string | null;
  planPriceLabel: string | null;
  staffLimit: number;
  staffCount: number;
  billingStatus: string | null;
  accountStatus: string | null;
  subscriptionPeriodStart: number | null;
  subscriptionPeriodEnd: number | null;
  stripeSubscriptionId: string | null;
  hasStripeCustomer: boolean;
  hasFreeTrial: boolean;
  trialStart: number | null;
  trialEnd: number | null;
  trialDays: number;
  validityDays: number;
  billingCycle: "weekly" | "monthly" | null;
  /** SMS package bundled with the current subscription plan. */
  bundledSmsPackage: BundledSmsSnapshot;
  smsLimit: number;
  smsUsed: number;
  smsRemaining: number | null;
  smsBundlePeriodEnd: number | null;
  smsBundleRenewsWithPlan: boolean;
  /** True when payment is required (trial / pending) and no Stripe subscription yet. */
  needsPaymentDetails: boolean;
  isTrialing: boolean;
  /** True when subscription/trial ended — dashboard access is limited to billing. */
  accessBlocked: boolean;
};

export type PlanChangeAssessment = {
  direction: PlanChangeDirection;
  allowed: boolean;
  blockReason: string | null;
  staffCount: number;
  currentStaffLimit: number;
  targetStaffLimit: number;
};

export type AvailablePlanOption = SubscriptionPlanDisplay & {
  direction: PlanChangeDirection;
  changeAllowed: boolean;
  blockReason: string | null;
};
