import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import { createSmsCheckoutSession } from "@/lib/stripe/checkout";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Start Stripe Checkout for a one-time SMS top-up. */
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
      { ok: false, error: "packageId is required." },
      { status: 400 },
    );
  }

  try {
    const session = await createSmsCheckoutSession({
      businessId: auth.businessId,
      packageId,
      customerEmail: auth.email ?? null,
    });
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.sessionId });
  } catch (error) {
    console.error("[stripe checkout sms]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not start SMS checkout.",
      },
      { status: 400 },
    );
  }
}
