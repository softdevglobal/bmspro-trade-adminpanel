import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import { confirmCheckoutSessionForBusiness } from "@/lib/stripe/fulfill";
import { getBusinessSmsBalance } from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Confirms a Stripe Checkout session after redirect (no webhook required). */
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

  const sessionId =
    body &&
    typeof body === "object" &&
    typeof (body as { sessionId?: unknown }).sessionId === "string"
      ? (body as { sessionId: string }).sessionId.trim()
      : "";

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "sessionId is required." },
      { status: 400 },
    );
  }

  try {
    const result = await confirmCheckoutSessionForBusiness(
      sessionId,
      auth.businessId,
    );

    const balance =
      result.type === "sms_topup"
        ? await getBusinessSmsBalance(auth.businessId)
        : null;

    return NextResponse.json({
      ok: true,
      alreadyFulfilled: result.alreadyFulfilled,
      type: result.type,
      balance,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not confirm checkout.",
      },
      { status: 400 },
    );
  }
}
