import { requireSuperAdmin } from "@/lib/onboarding/server";
import { validateSmsPackageDescription } from "@/lib/sms-packages/helpers";
import {
  createSmsPackage,
  deleteSmsPackage,
  countTenantsBySmsPackage,
  listSmsPackages,
  syncAllUnlinkedSmsPackages,
  updateSmsPackage,
} from "@/lib/sms-packages/server";
import type { SmsPackageInput } from "@/lib/sms-packages/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseSmsPackageBody(
  body: unknown,
): { ok: true; input: SmsPackageInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return { ok: false, error: "SMS package name is required." };
  }

  const description = validateSmsPackageDescription(raw.description);
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
      messageQuota:
        typeof raw.messageQuota === "number" && Number.isFinite(raw.messageQuota)
          ? raw.messageQuota
          : 100,
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
      plan_key: typeof raw.plan_key === "string" ? raw.plan_key : null,
      description: description.value,
    },
  };
}

/** Super admin — list all SMS packages (including inactive/hidden). */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  await syncAllUnlinkedSmsPackages();

  const packages = await listSmsPackages({
    includeInactive: true,
    includeHidden: true,
  });
  const tenantCounts = await countTenantsBySmsPackage();
  return NextResponse.json({
    ok: true,
    packages,
    tenantCounts,
  });
}

/** Super admin — create an SMS package. */
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

  const parsed = parseSmsPackageBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  try {
    const pkg = await createSmsPackage(parsed.input);
    return NextResponse.json({ ok: true, package: pkg }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not create SMS package.",
      },
      { status: 400 },
    );
  }
}

/** Super admin — update an SMS package. */
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
  const packageId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!packageId) {
    return NextResponse.json(
      { ok: false, error: "SMS package id is required." },
      { status: 400 },
    );
  }

  const parsed = parseSmsPackageBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  const pkg = await updateSmsPackage(packageId, parsed.input);
  if (!pkg) {
    return NextResponse.json(
      { ok: false, error: "SMS package not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, package: pkg });
}

/** Super admin — delete an SMS package. */
export async function DELETE(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const packageId = url.searchParams.get("id")?.trim() ?? "";
  if (!packageId) {
    return NextResponse.json(
      { ok: false, error: "SMS package id is required." },
      { status: 400 },
    );
  }

  const deleted = await deleteSmsPackage(packageId);
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: "SMS package not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
