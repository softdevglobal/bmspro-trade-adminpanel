import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import { createSubscriptionCheckoutSession } from "@/lib/stripe/checkout";
import { isTrialCalendarActive } from "@/lib/subscription-plans/access";
import {
  assessPlanChange,
  getTenantSubscriptionSnapshot,
} from "@/lib/subscription-plans/tenant-subscription";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Start Stripe Checkout for a subscription plan (recurring). */
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

  const planId =
    body &&
    typeof body === "object" &&
    typeof (body as { planId?: unknown }).planId === "string"
      ? (body as { planId: string }).planId.trim()
      : "";

  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "planId is required." },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;
  const successPath =
    typeof raw.successPath === "string" && raw.successPath.trim()
      ? raw.successPath.trim()
      : undefined;
  const cancelPath =
    typeof raw.cancelPath === "string" && raw.cancelPath.trim()
      ? raw.cancelPath.trim()
      : undefined;

  const changeCheck = await assessPlanChange(auth.businessId, planId);
  if (!changeCheck.ok) {
    return NextResponse.json(
      { ok: false, error: changeCheck.error },
      { status: 400 },
    );
  }
  if (!changeCheck.assessment.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          changeCheck.assessment.blockReason ??
          "This plan change is not allowed.",
      },
      { status: 400 },
    );
  }

  const snapshot = await getTenantSubscriptionSnapshot(auth.businessId);
  if (snapshot && isTrialCalendarActive(snapshot)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No payment is required during your free trial. You can subscribe after the trial ends.",
      },
      { status: 400 },
    );
  }

  try {
    const session = await createSubscriptionCheckoutSession({
      businessId: auth.businessId,
      planId,
      customerEmail: auth.email ?? null,
      successPath,
      cancelPath,
    });
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.sessionId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not start subscription checkout.",
      },
      { status: 400 },
    );
  }
}
