import { requireSuperAdmin } from "@/lib/onboarding/server";
import {
  createSubscriptionPlan,
  deleteSubscriptionPlan,
  countTenantsByPlan,
  listSubscriptionPlans,
  updateSubscriptionPlan,
} from "@/lib/subscription-plans/server";
import type { SubscriptionPlanInput } from "@/lib/subscription-plans/types";
import { validatePlanDescription } from "@/lib/subscription-plans/helpers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parsePlanBody(
  body: unknown,
): { ok: true; input: SubscriptionPlanInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return { ok: false, error: "Plan name is required." };
  }

  const description = validatePlanDescription(raw.description);
  if (!description.ok) {
    return description;
  }

  return {
    ok: true,
    input: {
      name,
      price:
        typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : 0,
      priceLabel:
        typeof raw.priceLabel === "string" ? raw.priceLabel : undefined,
      branches:
        typeof raw.branches === "number" && Number.isFinite(raw.branches)
          ? raw.branches
          : 1,
      staff:
        typeof raw.staff === "number" && Number.isFinite(raw.staff)
          ? raw.staff
          : 5,
      features: Array.isArray(raw.features)
        ? raw.features.filter((f): f is string => typeof f === "string")
        : [],
      popular: raw.popular === true,
      color: typeof raw.color === "string" ? raw.color : undefined,
      image: typeof raw.image === "string" ? raw.image : undefined,
      icon: typeof raw.icon === "string" ? raw.icon : undefined,
      active: raw.active !== false,
      hidden: raw.hidden === true,
      stripePriceId:
        typeof raw.stripePriceId === "string" ? raw.stripePriceId : null,
      trialDays:
        typeof raw.trialDays === "number" && Number.isFinite(raw.trialDays)
          ? raw.trialDays
          : 0,
      plan_key: typeof raw.plan_key === "string" ? raw.plan_key : null,
      billingCycle: raw.billingCycle === "monthly" ? "monthly" : "weekly",
      description: description.value,
    },
  };
}

/** Super admin — list all subscription plans (including inactive/hidden). */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const plans = await listSubscriptionPlans({
    includeInactive: true,
    includeHidden: true,
  });
  const tenantCounts = await countTenantsByPlan();
  return NextResponse.json({ ok: true, plans, tenantCounts });
}

/** Super admin — create a subscription plan. */
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

  const parsed = parsePlanBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  try {
    const plan = await createSubscriptionPlan(parsed.input);
    return NextResponse.json({ ok: true, plan }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not create plan.",
      },
      { status: 400 },
    );
  }
}

/** Super admin — update a subscription plan. */
export async function PUT(request: Request) {
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const raw = body as Record<string, unknown>;
  const planId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "Plan id is required." },
      { status: 400 },
    );
  }

  const parsed = parsePlanBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  const plan = await updateSubscriptionPlan(planId, parsed.input);
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "Plan not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, plan });
}

/** Super admin — delete a subscription plan. */
export async function DELETE(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const planId = url.searchParams.get("id")?.trim() ?? "";
  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "Plan id is required." },
      { status: 400 },
    );
  }

  const deleted = await deleteSubscriptionPlan(planId);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: "Plan not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
