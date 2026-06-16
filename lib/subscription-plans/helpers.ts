import type { BillingCycle } from "@/lib/subscription-plans/types";

export function normalizeBillingCycle(value: unknown): BillingCycle {
  return value === "monthly" ? "monthly" : "weekly";
}

export function validityDaysForCycle(cycle: BillingCycle): number {
  return cycle === "monthly" ? 28 : 7;
}

export function formatPriceLabel(price: number, cycle: BillingCycle): string {
  const unit = cycle === "monthly" ? "month" : "week";
  return `AU$${price}/${unit}`;
}

export function formatPeriodLabel(validityDays: number): string {
  return `${validityDays}-day`;
}

export function formatBillingNote(cycle: BillingCycle, validityDays: number): string {
  const unit = cycle === "monthly" ? "Monthly" : "Weekly";
  return `${unit} • ${validityDays}-day renewal`;
}

const PLAN_DESCRIPTION_MAX_LENGTH = 500;

export function validatePlanDescription(
  description: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof description === "string" ? description.trim() : "";
  if (!value) {
    return { ok: false, error: "Plan description is required." };
  }
  if (value.length > PLAN_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      error: `Plan description must be ${PLAN_DESCRIPTION_MAX_LENGTH} characters or less.`,
    };
  }
  return { ok: true, value };
}
