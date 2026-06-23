import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import {
  getBusinessSmsBalance,
  listSmsPackages,
  purchaseSmsPackageForBusiness,
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

/** Business owner — purchase an SMS top-up package (adds credits to limit). */
export async function POST(request: Request) {
  if (isStripeConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "SMS top-ups are processed through Stripe Checkout. Open SMS Credits and pay with Stripe.",
      },
      { status: 403 },
    );
  }

  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const packageId =
    body &&
    typeof body === "object" &&
    typeof (body as { packageId?: unknown }).packageId === "string"
      ? (body as { packageId: string }).packageId.trim()
      : "";

  if (!packageId) {
    return NextResponse.json(
      { ok: false, error: "SMS package id is required." },
      { status: 400 },
    );
  }

  try {
    const balance = await purchaseSmsPackageForBusiness(
      auth.businessId,
      packageId,
    );
    return NextResponse.json({ ok: true, balance });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not purchase SMS package.",
      },
      { status: 400 },
    );
  }
}
