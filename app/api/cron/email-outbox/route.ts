import { isEmailSendEnabled } from "@/lib/email-integration/config";
import { processEmailOutbox } from "@/lib/email-integration/outbox";
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

/**
 * Recovery worker for business-mailbox sends. Most items are sent right after
 * queueing; this picks up retries and interrupted sends. Rollback: turn
 * EMAIL_SEND_ENABLED off — the worker pauses and keeps every record.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isEmailSendEnabled()) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  try {
    const result = await processEmailOutbox();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/email-outbox] failed", (error as Error)?.name);
    return NextResponse.json(
      { ok: false, error: "Email outbox run failed." },
      { status: 500 },
    );
  }
}
