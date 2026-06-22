import { updateTenantStatus } from "@/lib/onboarding/business-status";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import type { TenantStatus } from "@/lib/onboarding/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseStatus(value: unknown): Extract<TenantStatus, "active" | "suspended"> | null {
  if (value === "active" || value === "suspended") return value;
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const businessId = id?.trim() ?? "";
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "Tenant id is required." },
      { status: 400 },
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

  const status = parseStatus(
    body && typeof body === "object" ? (body as Record<string, unknown>).status : null,
  );
  if (!status) {
    return NextResponse.json(
      { ok: false, error: 'Status must be "active" or "suspended".' },
      { status: 400 },
    );
  }

  const result = await updateTenantStatus({
    businessId,
    status,
    actorUid: auth.uid,
    actorEmail: auth.email,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    businessId,
    status,
    isActive: status === "active",
  });
}
