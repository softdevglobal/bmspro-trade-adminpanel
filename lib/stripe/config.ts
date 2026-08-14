import "server-only";

import { resolveAppBaseUrl } from "@/lib/config/base-url";

/** True when server-side Stripe calls are allowed. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/**
 * Webhook signing secrets, newest first.
 *
 * Stripe issues one secret per event destination, and this app needs two: a
 * "Your account" destination for subscription billing (`invoice.paid`,
 * `customer.subscription.deleted`) and a "Connected accounts" destination for
 * customer payments and Connect onboarding (`checkout.session.completed`,
 * `account.updated`). Both point at the same route, so `STRIPE_WEBHOOK_SECRET`
 * accepts a comma-separated list and the route tries each. It also makes secret
 * rotation a two-step change rather than a cutover with dropped events.
 */
export function getStripeWebhookSecrets(): string[] {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/** True when Stripe webhook signature verification is configured. */
export function isStripeWebhookConfigured(): boolean {
  return isStripeConfigured() && getStripeWebhookSecrets().length > 0;
}

/** Platform Connect client id (`ca_...`) used for Standard OAuth onboarding. */
export function getStripeConnectClientId(): string | null {
  return process.env.STRIPE_CLIENT_ID?.trim() || null;
}

/** True when Stripe Connect (Standard OAuth) onboarding is available. */
export function isStripeConnectConfigured(): boolean {
  return isStripeConfigured() && Boolean(getStripeConnectClientId());
}

/**
 * Public site URL for Checkout success/cancel redirects and payment links.
 *
 * Throws when deployed without a usable origin rather than emitting a localhost
 * link — pay-link callers catch this and drop the link, which is recoverable,
 * whereas a dead link inside a customer's PDF is not.
 */
export function getAppBaseUrl(): string {
  const url = resolveAppBaseUrl();
  if (!url) {
    throw new Error(
      "No public app URL configured. Set APP_URL to the live origin (e.g. https://app.bmspros.com.au).",
    );
  }
  return url;
}
