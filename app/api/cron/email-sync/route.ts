import { isEmailSendEnabled } from "@/lib/email-integration/config";
import { mapConnectionDoc } from "@/lib/email-integration/connections";
import { syncMailbox } from "@/lib/email-integration/mailbox/sync";
import { EMAIL_CONNECTIONS_COLLECTION } from "@/lib/email-integration/config";
import { adminDb } from "@/lib/firebase/admin";
import { FieldPath } from "firebase-admin/firestore";
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
    const cursorRef = adminDb.doc("email_sync_state/_scheduler/rotation/mailboxes");
    const eligible = adminDb.collection(EMAIL_CONNECTIONS_COLLECTION)
      .where("capabilities", "array-contains", "read")
      .orderBy(FieldPath.documentId()).limit(1);
    const started = Date.now();
    const results: Record<string, number> = {};
    let mailboxes = 0;
    for (let i = 0; i < MAX_MAILBOXES_PER_RUN; i++) {
      if (Date.now() - started >= 45_000) break;
      // Claim one turn at a time so a timeout or overlapping cron cannot rewind the cursor.
      const doc = await adminDb.runTransaction(async (tx) => {
        const lastId = (await tx.get(cursorRef)).get("lastId");
        const page = await tx.get(lastId ? eligible.startAfter(lastId) : eligible);
        const next = page.docs[0];
        tx.set(cursorRef, { lastId: next?.id ?? null });
        return next;
      });
      if (!doc) break;
      const connection = mapConnectionDoc(doc.id, doc.data());
      if (connection.status !== "active" || !isEmailSendEnabled(connection.businessId)) continue;
      mailboxes++;
      const remaining = 50_000 - (Date.now() - started);
      const outcome = await syncMailbox(connection, { budgetMs: Math.max(1, remaining - 5_000) });
      const key = outcome.ok ? outcome.mode : outcome.code;
      results[key] = (results[key] ?? 0) + 1;
    }
    return NextResponse.json({ ok: true, mailboxes, results });
  } catch (error) {
    console.error("[cron/email-sync] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email sync run failed." }, { status: 500 });
  }
}
