import {
  logPasswordChanged,
  resolveAuditIdentityForUid,
} from "@/lib/audit/action-logs";
import { CUSTOMER_COLLECTION } from "@/lib/customer/types";
import {
  buildCustomerAuthEmail,
  customerPasswordResetDocId,
} from "@/lib/customer/scoped-auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

const COLLECTION = "customerPasswordResetCodes";
const MIN_PASSWORD_LENGTH = 6;

export async function POST(req: NextRequest) {
  try {
    const { email, code, newPassword, bookingSlug } = (await req.json()) as {
      email?: string;
      code?: string;
      newPassword?: string;
      bookingSlug?: string;
    };

    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedCode = code?.trim();
    const trimmedSlug =
      typeof bookingSlug === "string" ? bookingSlug.trim() : "";

    if (!trimmedEmail || !trimmedCode || !newPassword || !trimmedSlug) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    const docRef = adminDb
      .collection(COLLECTION)
      .doc(customerPasswordResetDocId(trimmedSlug, trimmedEmail));
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json(
        { error: "Invalid or expired code." },
        { status: 400 },
      );
    }

    const data = snap.data()!;

    if (data.used === true) {
      return NextResponse.json(
        { error: "This code has already been used." },
        { status: 400 },
      );
    }

    const expiresAt = (data.expiresAt as Timestamp).toMillis();
    if (Date.now() > expiresAt) {
      await docRef.delete();
      return NextResponse.json(
        { error: "Code has expired. Please request a new one." },
        { status: 400 },
      );
    }

    const attempts = (data.attempts as number) + 1;
    if (attempts > 5) {
      await docRef.delete();
      return NextResponse.json(
        { error: "Too many incorrect attempts. Please request a new code." },
        { status: 400 },
      );
    }

    if (data.code !== trimmedCode) {
      await docRef.update({ attempts });
      return NextResponse.json(
        { error: `Incorrect code. ${5 - attempts + 1} attempt(s) remaining.` },
        { status: 400 },
      );
    }

    const authEmail = await buildCustomerAuthEmail(trimmedSlug, trimmedEmail);

    let uid: string;
    try {
      const userRecord = await adminAuth.getUserByEmail(authEmail);
      uid = userRecord.uid;
    } catch {
      return NextResponse.json(
        { error: "No account found for this email with this business." },
        { status: 400 },
      );
    }

    const customerSnap = await adminDb
      .collection(CUSTOMER_COLLECTION)
      .doc(uid)
      .get();
    if (!customerSnap.exists) {
      return NextResponse.json(
        { error: "No customer account found for this email." },
        { status: 400 },
      );
    }

    await adminAuth.updateUser(uid, { password: newPassword });
    await docRef.update({ used: true });

    const identity = await resolveAuditIdentityForUid(uid);
    const customerData = customerSnap.data() ?? {};
    await logPasswordChanged({
      uid,
      email: trimmedEmail,
      name: identity.name,
      role: "customer",
      businessId:
        typeof customerData.registeredBusinessId === "string"
          ? customerData.registeredBusinessId
          : identity.businessId,
      source: "customer_portal",
      method: "reset_code",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[customer reset-password]", err);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 },
    );
  }
}
