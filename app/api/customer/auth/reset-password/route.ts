import { consumeResetCode } from "@/lib/auth/reset-codes";
import { completeAccountActivation } from "@/lib/auth/activation";
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
import { NextRequest, NextResponse } from "next/server";

const COLLECTION = "customerPasswordResetCodes";
const MIN_PASSWORD_LENGTH = 12;

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

    if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 128) {
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
    if (!(await consumeResetCode(docRef, trimmedCode))) {
      return NextResponse.json({ error: "Invalid, expired, or already used code." }, { status: 400 });
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
    await completeAccountActivation(uid);

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
