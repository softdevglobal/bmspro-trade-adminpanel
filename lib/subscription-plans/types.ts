/** Firestore collection for sellable subscription packages. */
export const SUBSCRIPTION_PLANS_COLLECTION = "subscription_plans";

export type BillingCycle = "weekly" | "monthly";

export type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  staff: number;
  features: string[];
  popular: boolean;
  color: string;
  image: string;
  icon: string;
  active: boolean;
  hidden: boolean;
  stripePriceId: string | null;
  stripeProductId: string | null;
  trialDays: number;
  plan_key: string | null;
  billingCycle: BillingCycle;
  validityDays: number;
  description: string | null;
  smsPackageId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type SubscriptionPlanInput = {
  name: string;
  price: number;
  priceLabel?: string;
  staff: number;
  features?: string[];
  popular?: boolean;
  color?: string;
  image?: string;
  icon?: string;
  active?: boolean;
  hidden?: boolean;
  stripePriceId?: string | null;
  stripeProductId?: string | null;
  trialDays?: number;
  plan_key?: string | null;
  billingCycle?: BillingCycle;
  description?: string | null;
  smsPackageId?: string | null;
};
