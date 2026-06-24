import type { TenantSubscriptionSnapshot } from "@/lib/subscription-plans/tenant-types";

type SubscriptionAccessInput = Pick<
  TenantSubscriptionSnapshot,
  | "trialEnd"
  | "trialDays"
  | "hasFreeTrial"
  | "subscriptionPeriodEnd"
  | "billingStatus"
  | "accountStatus"
>;

/** True while the calendar free-trial window (trial_end) has not passed. */
export function isTrialCalendarActive(
  subscription: Pick<TenantSubscriptionSnapshot, "trialEnd">,
): boolean {
  const now = Date.now();
  return Boolean(subscription.trialEnd && subscription.trialEnd > now);
}

/** True when this tenant had a free trial and the trial window is over. */
export function isTrialEndedRequiringPayment(
  subscription: Pick<
    TenantSubscriptionSnapshot,
    "trialEnd" | "trialDays" | "hasFreeTrial"
  >,
): boolean {
  if (isTrialCalendarActive(subscription)) return false;
  return (
    subscription.hasFreeTrial ||
    subscription.trialDays > 0 ||
    Boolean(subscription.trialEnd)
  );
}

/** True when the tenant may not use the dashboard until subscription is renewed. */
export function isTenantSubscriptionAccessBlocked(
  subscription: SubscriptionAccessInput,
): boolean {
  const now = Date.now();

  // Free trial — full access, no payment required.
  if (isTrialCalendarActive(subscription)) {
    return false;
  }

  // Paid subscription with a valid billing period.
  if (
    subscription.billingStatus === "active" &&
    subscription.subscriptionPeriodEnd &&
    subscription.subscriptionPeriodEnd > now
  ) {
    return false;
  }

  if (
    subscription.billingStatus === "canceled" ||
    subscription.accountStatus === "canceled"
  ) {
    return true;
  }

  // Trial calendar ended — must pay and renew via Stripe.
  if (
    isTrialEndedRequiringPayment({
      trialEnd: subscription.trialEnd,
      trialDays: subscription.trialDays ?? 0,
      hasFreeTrial: subscription.hasFreeTrial ?? false,
    })
  ) {
    return true;
  }

  // No trial on plan — must complete first payment before dashboard access.
  if (
    subscription.billingStatus !== "active" &&
    subscription.accountStatus !== "active"
  ) {
    return true;
  }

  if (
    subscription.subscriptionPeriodEnd &&
    subscription.subscriptionPeriodEnd <= now
  ) {
    return true;
  }

  return false;
}
