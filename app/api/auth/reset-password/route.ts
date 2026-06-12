import {
  logPasswordChanged,
  resolveAuditIdentityForUid,
} from "@/lib/audit/action-logs";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
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

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }

    const docRef = adminDb.collection("passwordResetCodes").doc(trimmedEmail);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    const data = snap.data()!;

    // Check used
    if (data.used === true) {
      return NextResponse.json({ error: "This code has already been used." }, { status: 400 });
    }

    // Check expiry
    const expiresAt = (data.expiresAt as Timestamp).toMillis();
    if (Date.now() > expiresAt) {
      await docRef.delete();
      return NextResponse.json({ error: "Code has expired. Please request a new one." }, { status: 400 });
    }

    // Track attempts (max 5)
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
    await docRef.update({ used: true });

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
