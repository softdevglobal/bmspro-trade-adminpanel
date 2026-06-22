import { sendPasswordResetCodeEmail } from "@/lib/email/templates";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    const trimmed = email?.trim().toLowerCase();

    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }

    // Check the user exists in Firebase Auth
    let authUid: string;
    try {
      const authUser = await adminAuth.getUserByEmail(trimmed);
      authUid = authUser.uid;
    } catch {
      // Return success even for unknown emails to avoid user enumeration
      return NextResponse.json({ ok: true });
    }

    let businessName: string | null = null;
    let logoUrl: string | null = null;
    const userSnap = await adminDb.collection("users").doc(authUid).get();
    const userData = userSnap.data();
    const phone =
      typeof userData?.phone === "string" ? userData.phone : null;
    const businessId =
      typeof userData?.businessId === "string" ? userData.businessId : null;
    if (businessId) {
      const profile = await getBusinessProfile(businessId);
      if (profile) {
        businessName = profile.businessName;
        logoUrl = profile.logoUrl;
      }
    }

    // Rate-limit: only one code per email per 60 seconds
    const docRef = adminDb.collection("passwordResetCodes").doc(trimmed);
    const existing = await docRef.get();
    if (existing.exists) {
      const data = existing.data();
      const createdAt = (data?.createdAt as Timestamp | undefined)?.toMillis() ?? 0;
      if (Date.now() - createdAt < 60_000) {
        return NextResponse.json(
          { error: "A code was already sent. Please wait 60 seconds before requesting another." },
          { status: 429 },
        );
      }
    }

    const code = generateCode();
    const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);

    await docRef.set({
      code,
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
      used: false,
    });

    await sendPasswordResetCodeEmail({
      email: trimmed,
      phone,
      code,
      businessName,
      logoUrl,
      businessId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[send-reset-code]", err);
    return NextResponse.json({ error: "Failed to send code. Please try again." }, { status: 500 });
  }
}
