import { createPaymentCheckoutSession } from "@/lib/stripe/payments";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public endpoint. Given a secure token, computes the amount on the server and
 * creates a Stripe Checkout session. No auth — the opaque token is the
 * capability, and the amount is never taken from the client.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const token =
    typeof (body as Record<string, unknown>)?.token === "string"
      ? ((body as Record<string, unknown>).token as string).trim()
      : "";
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Payment token is required." },
      { status: 400 },
    );
  }

  const result = await createPaymentCheckoutSession(token);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, url: result.url });
}
