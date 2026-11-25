/**
 * GET ?view=inbox|sent|archive|trash&linked=1&date=YYYY-MM-DD — how many emails a folder has: all,
 * unread, and on one day (default today, in the business time zone). Counted in Firestore from the
 * imported copy of the mailbox, so there is no provider call and no page needs to be open. While the
 * import is still running (status.historyComplete false) the counts cover only the mail imported so far.
 */

import { emailError } from "@/lib/email-integration/auth";
import { requireMailbox } from "@/lib/email-integration/mailbox/access";
import { countMailboxMessages, getSyncStatus } from "@/lib/email-integration/mailbox/store";
import type { MailboxFolder } from "@/lib/email-integration/types";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { platformTodayIso, resolvePlatformTimeZone } from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOLDERS: MailboxFolder[] = ["inbox", "sent", "archive", "trash"];

/** The next calendar day of a real YYYY-MM-DD date, or null when it is not one. */
function nextIsoDay(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const day = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== iso) return null;
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const gate = await requireMailbox(request, { capability: "read" });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const view = (searchParams.get("view") ?? "inbox") as MailboxFolder;
  if (!FOLDERS.includes(view)) return emailError(400, "view must be inbox, sent, archive or trash.");
  const linkedOnly = searchParams.get("linked") === "1";

  const timeZone = resolvePlatformTimeZone((await getBusinessProfile(gate.businessId))?.timezone);
  const today = platformTodayIso(new Date(), timeZone);
  const date = searchParams.get("date")?.trim() || today;
  const next = nextIsoDay(date);
  if (!next || date > today) return emailError(400, "date must be today or an earlier YYYY-MM-DD.");
  const from = zonedDateTimeToUtcMs(date, "00:00", timeZone);
  const to = zonedDateTimeToUtcMs(next, "00:00", timeZone);
  if (from === null || to === null) return emailError(400, "That day can't be counted.");

  try {
    const [counts, status] = await Promise.all([
      countMailboxMessages({ connectionId: gate.connection.id, folder: view, linkedOnly, from, to }),
      getSyncStatus(gate.connection.id),
    ]);
    return NextResponse.json({
      ok: true,
      view,
      linked: linkedOnly,
      total: counts.total,
      unread: counts.unread,
      day: { date, total: counts.dayTotal, unread: counts.dayUnread },
      status,
    });
  } catch {
    return emailError(503, "Email counts aren't available right now. Try again.");
  }
}
