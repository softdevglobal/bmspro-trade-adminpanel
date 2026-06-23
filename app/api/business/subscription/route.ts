import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConfigured } from "@/lib/stripe/config";
import {
  applyPlanChangeToTenant,
  listAvailablePlansForTenant,
} from "@/lib/subscription-plans/tenant-subscription";
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

/** Business owner — change plan without Stripe (local/dev only). */
export async function POST(request: Request) {
  if (isStripeConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Plan changes are completed through Stripe Checkout. Use Upgrade or Downgrade on a plan card.",
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

  try {
    await applyPlanChangeToTenant(auth.businessId, planId);
    const { snapshot, plans } = await listAvailablePlansForTenant(
      auth.businessId,
    );
    return NextResponse.json({ ok: true, subscription: snapshot, plans });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not change plan.",
      },
      { status: 400 },
    );
  }
}
