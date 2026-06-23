import { requireSuperAdmin } from "@/lib/onboarding/server";
import { syncSubscriptionPlanToStripe } from "@/lib/subscription-plans/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Super admin — create or refresh Stripe product/price for a subscription plan. */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
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
    typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id.trim()
      : "";

  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "Plan id is required." },
      { status: 400 },
    );
  }

  try {
    const plan = await syncSubscriptionPlanToStripe(planId);
    if (!plan) {
      return NextResponse.json(
        { ok: false, error: "Subscription plan not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not sync plan to Stripe.",
      },
      { status: 400 },
    );
  }
}
