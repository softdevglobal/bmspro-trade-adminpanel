import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import { createBillingPortalSession } from "@/lib/stripe/checkout";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Stripe Customer Portal — manage payment method / subscription. */
export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Stripe is not configured on this server." },
      { status: 503 },
    );
  }

  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const session = await createBillingPortalSession({
      businessId: auth.businessId,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not open billing portal.",
      },
      { status: 400 },
    );
  }
}
