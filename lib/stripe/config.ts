import "server-only";

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

/** Public site URL for Checkout success/cancel redirects. */
export function getAppBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:3000";
  return url.replace(/\/$/, "");
}
