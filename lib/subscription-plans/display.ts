import type { SubscriptionPlan } from "@/lib/subscription-plans/types";

export type BundledSmsPackageSummary = {
  id: string;
  name: string;
  priceLabel: string;
  messageQuota: number;
  description: string | null;
  features: string[];
};

export type SubscriptionPlanDisplay = SubscriptionPlan & {
  bundledSmsPackage: BundledSmsPackageSummary | null;
};
