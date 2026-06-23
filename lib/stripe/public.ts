/** True when the browser should use Stripe Checkout (publishable key set). */
export function isStripeCheckoutEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim());
}
