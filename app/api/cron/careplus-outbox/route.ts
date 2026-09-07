import { processCareplusOutbox } from "@/lib/integrations/careplus/outbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (authHeader === `Bearer ${secret}`) return true;

  const cronHeader = request.headers.get("x-cron-secret")?.trim() ?? "";
  return cronHeader === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await processCareplusOutbox();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/careplus-outbox] failed", error);
    return NextResponse.json(
      { ok: false, error: "CarePlus outbox run failed." },
      { status: 500 },
    );
  }
}
