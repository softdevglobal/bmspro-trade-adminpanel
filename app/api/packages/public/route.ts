import { listSubscriptionPlans } from "@/lib/subscription-plans/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Public plan list for onboarding and signup (active, non-hidden only). */
export async function GET() {
  const plans = await listSubscriptionPlans({
    includeInactive: false,
    includeHidden: false,
  });
  return NextResponse.json({ ok: true, plans });
}
