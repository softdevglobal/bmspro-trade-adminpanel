import { getBusinessProfile } from "@/lib/onboarding/server";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { isStripeConnectConfigured } from "@/lib/stripe/config";
import {
  buildConnectAuthorizeUrl,
  disconnectBusinessConnectAccount,
} from "@/lib/stripe/connect";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Returns the Stripe Standard OAuth authorize URL for the owner's business. */
export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  if (!isStripeConnectConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Stripe Connect is not configured. Set STRIPE_SECRET_KEY and STRIPE_CLIENT_ID.",
      },
      { status: 503 },
    );
  }

  try {
    const profile = await getBusinessProfile(auth.businessId);
    const url = await buildConnectAuthorizeUrl({
      businessId: auth.businessId,
      businessName: profile?.businessName ?? null,
      ownerEmail: auth.email ?? profile?.businessEmail ?? null,
    });
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    console.error("[stripe connect] authorize failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not start the Stripe connection." },
      { status: 500 },
    );
  }
}

/** Disconnects the owner's connected Stripe account. */
export async function DELETE(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    await disconnectBusinessConnectAccount(auth.businessId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[stripe connect] disconnect failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not disconnect Stripe." },
      { status: 500 },
    );
  }
}
