import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { listSmsLogsForBusiness } from "@/lib/sms/sms-log-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Business owner — SMS delivery log for their workshop only. */
export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const logs = await listSmsLogsForBusiness(auth.businessId, 100);
  return NextResponse.json({ ok: true, logs });
}
