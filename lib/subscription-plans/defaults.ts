import type { SubscriptionPlanInput } from "@/lib/subscription-plans/types";

/** Seed documents use stable IDs so existing `businesses.plan.id` values keep working. */
export const DEFAULT_SUBSCRIPTION_PLAN_SEEDS: {
  id: string;
  input: SubscriptionPlanInput;
}[] = [
  {
    id: "booking_management",
    input: {
      name: "Job Management",
      price: 299,
      branches: 1,
      staff: 5,
      trialDays: 0,
      plan_key: "JOB_MGMT",
      billingCycle: "weekly",
      popular: false,
      color: "blue",
      icon: "assignment",
      description:
        "Jobs, calendar, customers, staff assignment and job tracking for your trade business.",
      features: [
        "Job & calendar management",
        "Customer records",
        "Staff assignment",
        "Up to 5 staff",
      ],
    },
  },
  {
    id: "trade_pro",
    input: {
      name: "Trade Pro",
      price: 399,
      branches: 1,
      staff: 5,
      trialDays: 7,
      plan_key: "TRADE_PRO",
      billingCycle: "weekly",
      popular: true,
      color: "blue",
      icon: "handyman",
      description:
        "Everything in Job Management plus quotes, invoices, contractor connections and partner jobs.",
      features: [
        "Everything in Job Management",
        "Quotations & invoices",
        "Contractor connections",
        "7-day free trial",
      ],
    },
  },
  {
    id: "trade_pro_front_desk",
    input: {
      name: "Trade Pro + Front Desk",
      price: 399,
      branches: 1,
      staff: 5,
      trialDays: 14,
      plan_key: "TRADE_PRO_FD",
      billingCycle: "weekly",
      popular: false,
      color: "slate",
      icon: "support_agent",
      description:
        "Includes reception service and trade software — we answer calls, make bookings, get work approvals, and give you the system to manage jobs, staff and daily activity.",
      features: [
        "Everything in Trade Pro",
        "Front desk reception service",
        "14-day free trial",
      ],
    },
  },
];
