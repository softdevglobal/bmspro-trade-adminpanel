import { consumeResetCode } from "@/lib/auth/reset-codes";
import { completeAccountActivation } from "@/lib/auth/activation";
import {
  logPasswordChanged,
  resolveAuditIdentityForUid,
} from "@/lib/audit/action-logs";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, code, newPassword } = (await req.json()) as {
      email?: string;
      code?: string;
      newPassword?: string;
    };

    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedCode = code?.trim();

    if (!trimmedEmail || !trimmedCode || !newPassword) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    if (newPassword.length < 12 || newPassword.length > 128) {
      return NextResponse.json(
        { error: "Password must be 12–128 characters." },
        { status: 400 },
      );
    }

    const docRef = adminDb.collection("passwordResetCodes").doc(trimmedEmail);
    if (!(await consumeResetCode(docRef, trimmedCode))) {
      return NextResponse.json({ error: "Invalid, expired, or already used code." }, { status: 400 });
    }

    // Code is valid — look up the user and update their password
    let uid: string;
    try {
      const userRecord = await adminAuth.getUserByEmail(trimmedEmail);
      uid = userRecord.uid;
    } catch {
      return NextResponse.json({ error: "No account found for this email." }, { status: 400 });
    }

    await adminAuth.updateUser(uid, { password: newPassword });

    // Mark code as used
    await completeAccountActivation(uid);

    const identity = await resolveAuditIdentityForUid(uid);
    await logPasswordChanged({
      uid,
      email: trimmedEmail,
      name: identity.name,
      role: identity.role,
      businessId: identity.businessId,
      source: "admin_panel",
      method: "reset_code",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Failed to reset password. Please try again." }, { status: 500 });
  }
}
