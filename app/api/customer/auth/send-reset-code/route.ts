import { allowResetCodeRequest, generateResetCode } from "@/lib/auth/reset-codes";
import { sendCustomerPasswordResetCodeEmail } from "@/lib/email/templates";
import { CUSTOMER_COLLECTION } from "@/lib/customer/types";
import {
  buildCustomerAuthEmail,
  customerPasswordResetDocId,
} from "@/lib/customer/scoped-auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

const COLLECTION = "customerPasswordResetCodes";

async function resolveBusinessBranding(
  customerData: Record<string, unknown>,
  bookingSlug: string,
): Promise<{
  businessId: string | null;
  businessName: string | null;
  logoUrl: string | null;
}> {
  if (bookingSlug) {
    const snap = await adminDb
      .collection("businesses")
      .where("bookingSlug", "==", bookingSlug)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data();
      return {
        businessId: doc.id,
        businessName:
          typeof data.businessName === "string" ? data.businessName : null,
        logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
      };
    }
  }

  const registeredBusinessId =
    typeof customerData.registeredBusinessId === "string"
      ? customerData.registeredBusinessId
      : null;
  const registeredBusinessName =
    typeof customerData.registeredBusinessName === "string"
      ? customerData.registeredBusinessName
      : null;

  if (registeredBusinessId) {
    const profile = await getBusinessProfile(registeredBusinessId);
    if (profile) {
      return {
        businessId: registeredBusinessId,
        businessName: profile.businessName ?? registeredBusinessName,
        logoUrl: profile.logoUrl,
      };
    }
  }

  return {
    businessId: registeredBusinessId,
    businessName: registeredBusinessName,
    logoUrl: null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      bookingSlug?: string;
    };
    const trimmed = body.email?.trim().toLowerCase();
    const bookingSlug =
      typeof body.bookingSlug === "string" ? body.bookingSlug.trim() : "";

    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "Invalid email address." },
        { status: 400 },
      );
    }

    if (!bookingSlug) {
      return NextResponse.json(
        { error: "Business booking link is required." },
        { status: 400 },
      );
    }

    // Throttled before the account lookup, so a throttled response cannot be
    // used to tell an existing address from an unknown one. Scoped per booking
    // slug, matching how customer accounts are namespaced.
    if (!(await allowResetCodeRequest(`customer:${bookingSlug}`, trimmed))) {
      return NextResponse.json(
        {
          error:
            "A code was already sent. Please wait 60 seconds before requesting another.",
        },
        { status: 429 },
      );
    }

    const authEmail = await buildCustomerAuthEmail(bookingSlug, trimmed);

    let authUid: string;
    try {
      const authUser = await adminAuth.getUserByEmail(authEmail);
      authUid = authUser.uid;
    } catch {
      return NextResponse.json({ ok: true });
    }

    const customerSnap = await adminDb
      .collection(CUSTOMER_COLLECTION)
      .doc(authUid)
      .get();
    if (!customerSnap.exists) {
      return NextResponse.json({ ok: true });
    }

    const customerData = customerSnap.data() ?? {};
    const phone =
      typeof customerData.phone === "string" ? customerData.phone : null;
    const { businessId, businessName, logoUrl } = await resolveBusinessBranding(
      customerData,
      bookingSlug,
    );

    const docRef = adminDb
      .collection(COLLECTION)
      .doc(customerPasswordResetDocId(bookingSlug, trimmed));
    const code = generateResetCode();
    const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);

    await docRef.set({
      code,
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
      used: false,
      bookingSlug,
      displayEmail: trimmed,
      authEmail,
    });

    await sendCustomerPasswordResetCodeEmail({
      email: trimmed,
      phone,
      code,
      businessName,
      logoUrl,
      businessId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[customer send-reset-code]", err);
    return NextResponse.json(
      { error: "Failed to send code. Please try again." },
      { status: 500 },
    );
  }
}
