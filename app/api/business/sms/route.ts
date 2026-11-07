import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import {
  getBusinessSmsBalance,
  listSmsPackages,
} from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";
export const runtime = "nodejs";

/** Business owner — SMS balance and available top-up packages. */
export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const [balance, packages] = await Promise.all([
    getBusinessSmsBalance(auth.businessId),
    listSmsPackages({ includeInactive: false, includeHidden: false }),
  ]);

  if (!balance) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, balance, packages });
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
        ? "SMS top-ups are processed through Stripe Checkout. Open SMS Credits and pay with Stripe."
        : "Billing is currently unavailable. Please try again later.",
    },
    { status: stripeConfigured ? 403 : 503 },
  );
}
