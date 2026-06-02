/**
 * Business profile API for the signed-in owner.
 *
 * GET   — returns business profile fields for the owner's business.
 * PATCH — updates logo, GST registration, or GST percentage.
 */

import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseGstPercentageInput(
  raw: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return {
      ok: false,
      error: "Enter a GST percentage between 0 and 100.",
    };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

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
  const updates: {
    logoUrl?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
  } = {};

  if ("logoUrl" in raw) {
    updates.logoUrl =
      typeof raw.logoUrl === "string" && raw.logoUrl.trim()
        ? raw.logoUrl.trim()
        : null;
  }

  if ("registeredForGst" in raw) {
    updates.registeredForGst = Boolean(raw.registeredForGst);
  }

  if ("gstPercentage" in raw) {
    if (raw.gstPercentage == null || raw.gstPercentage === "") {
      updates.gstPercentage = null;
    } else {
      const parsed = parseGstPercentageInput(raw.gstPercentage);
      if (!parsed.ok) {
        return NextResponse.json(
          { ok: false, error: parsed.error },
          { status: 400 },
        );
      }
      updates.gstPercentage = parsed.value;
    }
  }

  const current = await getBusinessProfile(auth.businessId);
  if (!current) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }

  const registeredForGst =
    "registeredForGst" in updates
      ? updates.registeredForGst!
      : current.registeredForGst;

  if (registeredForGst) {
    const nextGst =
      "gstPercentage" in updates
        ? updates.gstPercentage
        : current.gstPercentage;
    if (nextGst == null) {
      updates.gstPercentage = 10;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid fields to update." },
      { status: 400 },
    );
  }

  await updateBusinessProfile(auth.businessId, updates);
  const profile = await getBusinessProfile(auth.businessId);
  return NextResponse.json({ ok: true, profile });
}
