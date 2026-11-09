import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import { listAvailablePlansForTenant } from "@/lib/subscription-plans/tenant-subscription";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Business owner — current subscription, usage, and available plans. */
export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const { snapshot, plans } = await listAvailablePlansForTenant(
      auth.businessId,
    );
    return NextResponse.json({
      ok: true,
      subscription: snapshot,
      plans,
      stripeEnabled: isStripeConfigured(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load subscription.",
      },
      { status: 400 },
    );
  }
}

/** Direct billing changes are retired; fulfillment runs through Stripe Checkout. */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const stripeConfigured = isStripeConfigured();
  return NextResponse.json(
    {
      ok: false,
      error: stripeConfigured
        ? "Plan changes are completed through Stripe Checkout. Use Upgrade or Downgrade on a plan card."
        : "Billing is currently unavailable. Please try again later.",
    },
    { status: stripeConfigured ? 403 : 503 },
  );
}
