import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireStaffUser(request: Request) {
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

    if (!businessId || role !== "staff") {
      return { ok: false as const, status: 403, error: "Staff access required." };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
      businessId,
    };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid or expired session." };
  }
}

/** Staff still using the admin-assigned temporary password. */
export async function POST(request: Request) {
  const auth = await requireStaffUser(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const ref = adminDb.collection("users").doc(auth.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json(
      { ok: false, error: "Staff profile not found." },
      { status: 404 },
    );
  }

  const data = snap.data();
  if (data?.businessId !== auth.businessId || data?.role !== "staff") {
    return NextResponse.json(
      { ok: false, error: "Staff profile not found." },
      { status: 404 },
    );
  }

  await ref.update({
    mustChangePassword: true,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, mustChangePassword: true });
}

/** Staff completed their first password change. */
export async function PATCH(request: Request) {
  const auth = await requireStaffUser(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const ref = adminDb.collection("users").doc(auth.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json(
      { ok: false, error: "Staff profile not found." },
      { status: 404 },
    );
  }

  const data = snap.data();
  if (data?.businessId !== auth.businessId || data?.role !== "staff") {
    return NextResponse.json(
      { ok: false, error: "Staff profile not found." },
      { status: 404 },
    );
  }

  await ref.update({
    mustChangePassword: false,
    passwordChangedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, mustChangePassword: false });
}
