import "server-only";

import { resolveAppBaseUrl } from "@/lib/config/base-url";

/** True when server-side Stripe calls are allowed. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** True when Stripe webhook signature verification is configured. */
export function isStripeWebhookConfigured(): boolean {
  return (
    isStripeConfigured() && Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim())
  );
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
