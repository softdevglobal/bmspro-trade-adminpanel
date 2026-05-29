/**
 * Business profile API for the signed-in owner.
 *
 * GET   — returns { businessName, logoUrl } for the owner's business.
 * PATCH — updates the business logo URL (or clears it with null).
 */

import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import {
  getBusinessProfile,
  updateBusinessLogo,
} from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  const profile = await getBusinessProfile(auth.businessId);
  return NextResponse.json({ ok: true, profile });
}

export async function PATCH(request: Request) {
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

  const raw = (body ?? {}) as Record<string, unknown>;
  const logoUrl =
    typeof raw.logoUrl === "string" && raw.logoUrl.trim()
      ? raw.logoUrl.trim()
      : null;

  await updateBusinessLogo(auth.businessId, logoUrl);
  const profile = await getBusinessProfile(auth.businessId);
  return NextResponse.json({ ok: true, profile });
}
