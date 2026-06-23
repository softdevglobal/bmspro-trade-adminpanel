import type { TenantSubscriptionSnapshot } from "@/lib/subscription-plans/tenant-types";

type SubscriptionAccessInput = Pick<
  TenantSubscriptionSnapshot,
  | "isTrialing"
  | "trialEnd"
  | "subscriptionPeriodEnd"
  | "stripeSubscriptionId"
  | "billingStatus"
  | "accountStatus"
  | "needsPaymentDetails"
>;

/** True when the tenant may not use the dashboard until subscription is renewed. */
export function isTenantSubscriptionAccessBlocked(
  subscription: SubscriptionAccessInput,
): boolean {
  const now = Date.now();

  if (subscription.isTrialing && subscription.trialEnd && subscription.trialEnd > now) {
    return false;
  }

  if (
    subscription.subscriptionPeriodEnd &&
    subscription.subscriptionPeriodEnd > now &&
    (subscription.billingStatus === "active" ||
      subscription.billingStatus === "trialing" ||
      Boolean(subscription.stripeSubscriptionId))
  ) {
    return false;
  }

  if (
    subscription.subscriptionPeriodEnd &&
    subscription.subscriptionPeriodEnd <= now
  ) {
    return true;
  }

  if (
    subscription.trialEnd &&
    subscription.trialEnd <= now &&
    !subscription.stripeSubscriptionId
  ) {
    return true;
  }

  if (
    subscription.billingStatus === "canceled" ||
    subscription.accountStatus === "canceled"
  ) {
    return true;
  }

  if (
    !subscription.stripeSubscriptionId &&
    (subscription.needsPaymentDetails ||
      subscription.accountStatus === "pending_payment" ||
      subscription.billingStatus === "pending")
  ) {
    const trialOver = !subscription.trialEnd || subscription.trialEnd <= now;
    const periodOver =
      !subscription.subscriptionPeriodEnd ||
      subscription.subscriptionPeriodEnd <= now;
    if (trialOver && periodOver) {
      return true;
    }
  }

  return false;
}
