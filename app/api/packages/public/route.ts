import { listSubscriptionPlans } from "@/lib/subscription-plans/server";
import { enrichPlansWithBundledSms } from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Public plan list for onboarding and signup (active, non-hidden only). */
export async function GET() {
  const plans = await listSubscriptionPlans({
    includeInactive: false,
    includeHidden: false,
  });
  const plansWithSms = await enrichPlansWithBundledSms(plans);
  return NextResponse.json({ ok: true, plans: plansWithSms });
}
