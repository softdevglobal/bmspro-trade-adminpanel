import {
  debugScheduleReminders,
  runScheduleReminders,
} from "@/lib/scheduling/schedule-reminders";
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

/** Invoked every 5 minutes by the host cron (see vercel.json). */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";

  try {
    const result = await runScheduleReminders();
    if (debug) {
      const items = await debugScheduleReminders();
      return NextResponse.json({
        ok: true,
        ...result,
        debug: items,
        hint:
          "Reminders fire when leadMinutes is 25–35 (about 30 min before start). In local dev the poller runs every 5 min while npm run dev is active.",
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/schedule-reminders] failed", error);
    return NextResponse.json(
      { ok: false, error: "Schedule reminder run failed." },
      { status: 500 },
    );
  }
}
