import { isTenantSubscriptionAccessBlocked } from "@/lib/subscription-plans/access";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

/**
 * Session access for the signed-in business member (owner, admin or staff).
 *
 * The mobile app checks this on sign in, launch, resume and notification
 * taps (audit M3). Staff cannot read `businesses/{id}` under the Firestore
 * rules, so the subscription state comes from here. Only the fields the
 * access rule needs are returned — no billing identifiers.
 *
 * Inactive or suspended businesses and invalid sessions are refused by
 * `requireBusinessMember` (403 / 401).
 */
export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const snap = await adminDb.collection("businesses").doc(auth.businessId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  }
  const data = snap.data() ?? {};

  const trialDays =
    typeof data.trialDays === "number" && Number.isFinite(data.trialDays)
      ? Math.max(0, data.trialDays)
      : 0;
  const subscription = {
    billingStatus: typeof data.billing_status === "string" ? data.billing_status : null,
    accountStatus: typeof data.accountStatus === "string" ? data.accountStatus : null,
    trialEnd: toMillis(data.trial_end),
    subscriptionPeriodEnd: toMillis(data.subscriptionPeriodEnd),
    trialDays,
    hasFreeTrial: data.hasFreeTrial === true || trialDays > 0,
  };

  return NextResponse.json(
    {
      ok: true,
      role: auth.role,
      businessId: auth.businessId,
      subscription,
      // The web dashboard's rule (lib/subscription-plans/access.ts).
      subscriptionBlocked: isTenantSubscriptionAccessBlocked(subscription),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
