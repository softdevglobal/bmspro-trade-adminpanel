import { requireSuperAdmin } from "@/lib/onboarding/server";
import { listSmsLogs } from "@/lib/sms/sms-log-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Super admin — SMS delivery log across all tenants. */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const logs = await listSmsLogs(200);
  return NextResponse.json({ ok: true, logs });
}
