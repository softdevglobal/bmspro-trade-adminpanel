import "server-only";

/** True when server-side Stripe calls are allowed. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** Public site URL for Checkout success/cancel redirects. */
export function getAppBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:3000";
  return url.replace(/\/$/, "");
}
