import { confirmPaymentSession } from "@/lib/stripe/payment-fulfillment";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public endpoint. Redirect-return fallback that verifies a Checkout session and
 * applies it immediately. Webhooks remain the source of truth; this only makes
 * the customer's return experience instant.
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

  const raw = (body ?? {}) as Record<string, unknown>;
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const sessionId =
    typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";

  if (!token || !sessionId) {
    return NextResponse.json(
      { ok: false, error: "Token and session id are required." },
      { status: 400 },
    );
  }

  const result = await confirmPaymentSession({ token, sessionId });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, status: result.status });
}
