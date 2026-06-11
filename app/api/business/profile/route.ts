/**
 * Business profile API for the signed-in owner.
 *
 * GET   — returns business profile fields for the owner's business.
 * PATCH — updates contact details, logo, GST, or quotation terms.
 */

import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/lib/onboarding/server";
import {
  findStaffOwnerPhoneConflict,
  PHONE_TAKEN_ERROR,
} from "@/lib/users/phone-uniqueness";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s()-]{6,}$/;

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
    businessName?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    abn?: string | null;
    logoUrl?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
    termsAndConditions?: string | null;
  } = {};

  if ("businessName" in raw) {
    if (typeof raw.businessName !== "string") {
      return NextResponse.json(
        { ok: false, error: "Business name is required." },
        { status: 400 },
      );
    }
    const trimmed = raw.businessName.trim();
    if (trimmed.length < 2) {
      return NextResponse.json(
        { ok: false, error: "Business name must be at least 2 characters." },
        { status: 400 },
      );
    }
    if (trimmed.length > 120) {
      return NextResponse.json(
        { ok: false, error: "Business name must be 120 characters or less." },
        { status: 400 },
      );
    }
    updates.businessName = trimmed;
  }

  if ("businessAddress" in raw) {
    if (raw.businessAddress == null) {
      updates.businessAddress = null;
    } else if (typeof raw.businessAddress === "string") {
      const trimmed = raw.businessAddress.trim();
      if (trimmed.length > 300) {
        return NextResponse.json(
          { ok: false, error: "Business address must be 300 characters or less." },
          { status: 400 },
        );
      }
      updates.businessAddress = trimmed || null;
    }
  }

  if ("businessEmail" in raw) {
    if (raw.businessEmail == null) {
      updates.businessEmail = null;
    } else if (typeof raw.businessEmail === "string") {
      const trimmed = raw.businessEmail.trim().toLowerCase();
      if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
        return NextResponse.json(
          { ok: false, error: "Enter a valid business email address." },
          { status: 400 },
        );
      }
      updates.businessEmail = trimmed || null;
    }
  }

  if ("businessPhone" in raw) {
    if (raw.businessPhone == null) {
      updates.businessPhone = null;
    } else if (typeof raw.businessPhone === "string") {
      const trimmed = raw.businessPhone.trim();
      if (trimmed && !PHONE_PATTERN.test(trimmed)) {
        return NextResponse.json(
          { ok: false, error: "Enter a valid business phone number." },
          { status: 400 },
        );
      }
      updates.businessPhone = trimmed || null;
    }
  }

  if (updates.businessPhone) {
    const phoneConflict = await findStaffOwnerPhoneConflict(
      updates.businessPhone,
      { excludeBusinessId: auth.businessId },
    );
    if (phoneConflict) {
      return NextResponse.json(
        { ok: false, error: PHONE_TAKEN_ERROR },
        { status: 400 },
      );
    }
  }

  if ("abn" in raw) {
    if (raw.abn == null) {
      updates.abn = null;
    } else if (typeof raw.abn === "string") {
      const trimmed = raw.abn.trim();
      if (trimmed.length > 20) {
        return NextResponse.json(
          { ok: false, error: "ABN must be 20 characters or less." },
          { status: 400 },
        );
      }
      updates.abn = trimmed || null;
    }
  }

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

  if ("termsAndConditions" in raw) {
    if (raw.termsAndConditions == null) {
      updates.termsAndConditions = null;
    } else if (typeof raw.termsAndConditions === "string") {
      const trimmed = raw.termsAndConditions.trim();
      if (trimmed.length > 5000) {
        return NextResponse.json(
          { ok: false, error: "Terms and conditions must be 5000 characters or less." },
          { status: 400 },
        );
      }
      updates.termsAndConditions = trimmed || null;
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
