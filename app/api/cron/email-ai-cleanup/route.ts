import { runRetention } from "@/lib/ai/email/retention";
import { adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (request.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

/**
 * Daily: Sophie's email retention sweep (docs/sophie-email-learning-and-auto-reply.md §15, step 11).
 * Deletes old triage rows, decisions, reply records and complaint cases, and retires old memory
 * examples. It runs whether or not sorting is switched on, because old rows stay old.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runRetention(adminDb);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/email-ai-cleanup] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email clean-up failed." }, { status: 500 });
  }
}
