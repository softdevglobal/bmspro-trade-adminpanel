import { listSmsPackages } from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Public SMS package list (active, non-hidden only). */
export async function GET() {
  const packages = await listSmsPackages({
    includeInactive: false,
    includeHidden: false,
  });
  return NextResponse.json({ ok: true, packages });
}
