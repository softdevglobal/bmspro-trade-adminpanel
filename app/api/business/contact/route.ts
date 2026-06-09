/**
 * Business contact lookup for signed-in business members (owner, admin, staff).
 *
 * GET — returns the owner's contact details so staff who cannot create
 * quotations can call the owner to request one after a visit.
 *
 * Response: { ok: true, ownerName, ownerPhone, businessName, businessPhone }
 */

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessMember(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false as const, status: 401, error: "Missing authorization header." };
  }
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (
      !businessId ||
      (role !== "owner" && role !== "admin" && role !== "staff")
    ) {
      return { ok: false as const, status: 403, error: "Business access required." };
    }
    return { ok: true as const, businessId };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid or expired session." };
  }
}

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const businessSnap = await adminDb
    .collection("businesses")
    .doc(auth.businessId)
    .get();
  if (!businessSnap.exists) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }

  const business = businessSnap.data() ?? {};
  const businessName =
    typeof business.businessName === "string" ? business.businessName : null;
  const businessPhone =
    typeof business.businessPhone === "string" && business.businessPhone.trim()
      ? business.businessPhone.trim()
      : null;
  const ownerUid =
    typeof business.ownerUid === "string" ? business.ownerUid : null;

  let ownerName: string | null = null;
  let ownerPhone: string | null = null;
  if (ownerUid) {
    const ownerSnap = await adminDb.collection("users").doc(ownerUid).get();
    const owner = ownerSnap.data() ?? {};
    ownerName =
      typeof owner.fullName === "string" && owner.fullName.trim()
        ? owner.fullName.trim()
        : null;
    ownerPhone =
      typeof owner.phone === "string" && owner.phone.trim()
        ? owner.phone.trim()
        : null;
  }

  return NextResponse.json({
    ok: true,
    ownerName,
    ownerPhone: ownerPhone ?? businessPhone,
    businessName,
    businessPhone,
  });
}
