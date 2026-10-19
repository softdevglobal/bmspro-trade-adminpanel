import { isEmailSendEnabled } from "@/lib/email-integration/config";
import { mapConnectionDoc } from "@/lib/email-integration/connections";
import { syncMailbox } from "@/lib/email-integration/mailbox/sync";
import { EMAIL_CONNECTIONS_COLLECTION } from "@/lib/email-integration/config";
import { adminDb } from "@/lib/firebase/admin";
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

const MAX_MAILBOXES_PER_RUN = 10;

/**
 * Bounded polling for mailboxes with inbox access. One lease per mailbox keeps
 * runs from overlapping; mailboxes are visited in turn so none starves.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isEmailSendEnabled()) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  try {
    const snap = await adminDb
      .collection(EMAIL_CONNECTIONS_COLLECTION)
      .where("capabilities", "array-contains", "read")
      .get();
    const connections = snap.docs
      .map((doc) => mapConnectionDoc(doc.id, doc.data()))
      .filter((connection) => connection.status === "active" && isEmailSendEnabled(connection.businessId))
      .slice(0, MAX_MAILBOXES_PER_RUN);

    // Share the function's time between mailboxes; unfinished imports resume next run.
    const started = Date.now();
    const results: Record<string, number> = {};
    for (const connection of connections) {
      const remaining = 50_000 - (Date.now() - started);
      if (remaining < 5_000) break;
      const outcome = await syncMailbox(connection, { budgetMs: remaining - 5_000 });
      const key = outcome.ok ? outcome.mode : outcome.code;
      results[key] = (results[key] ?? 0) + 1;
    }
    return NextResponse.json({ ok: true, mailboxes: connections.length, results });
  } catch (error) {
    console.error("[cron/email-sync] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email sync run failed." }, { status: 500 });
  }
}
