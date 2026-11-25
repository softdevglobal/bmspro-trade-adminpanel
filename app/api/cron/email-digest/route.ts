import { EMAIL_CONNECTIONS_COLLECTION, isEmailSendEnabled } from "@/lib/email-integration/config";
import { mapConnectionDoc } from "@/lib/email-integration/connections";
import { digestMessage } from "@/lib/email-integration/mailbox/digest";
import { newUnreadInbox } from "@/lib/email-integration/mailbox/store";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid, sendOwnerMobilePush } from "@/lib/notifications/push";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Server-only. One document per mailbox: when its last digest was claimed. */
const DIGEST_STATE = "email_digest_state";
const INTERVAL_MS = 30 * 60_000;
/** A run may fire a little early; anything under this since the last claim is the same half hour. */
const MIN_GAP_MS = 25 * 60_000;
const MAX_MAILBOXES_PER_RUN = 200;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (request.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

/**
 * Every 30 minutes: for each connected mailbox, push the owner a summary of the unread mail that arrived since
 * the last digest (count, plus sender and subject of the newest three). Nothing new means no push. Runs on the
 * server from the stored mailbox, so no dashboard or provider call is needed. A transaction claims each
 * half hour once, so overlapping runs cannot send it twice.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isEmailSendEnabled()) return NextResponse.json({ ok: true, skipped: "disabled" });

  try {
    const snap = await adminDb.collection(EMAIL_CONNECTIONS_COLLECTION)
      .where("capabilities", "array-contains", "read")
      .orderBy(FieldPath.documentId()).limit(MAX_MAILBOXES_PER_RUN).get();
    const result = { mailboxes: 0, pushed: 0, quiet: 0, skipped: 0 };
    const started = Date.now();
    for (const doc of snap.docs) {
      if (Date.now() - started >= 50_000) break;
      const connection = mapConnectionDoc(doc.id, doc.data());
      if (connection.status !== "active" || !isEmailSendEnabled(connection.businessId)) continue;
      result.mailboxes++;

      const now = Date.now();
      const ref = adminDb.collection(DIGEST_STATE).doc(connection.id);
      const since = await adminDb.runTransaction(async (tx) => {
        const last = (await tx.get(ref)).get("lastDigestAt");
        const lastMs = last instanceof Timestamp ? last.toMillis() : null;
        if (lastMs !== null && now - lastMs < MIN_GAP_MS) return null; // already sent this half hour
        tx.set(ref, { lastDigestAt: Timestamp.fromMillis(now), businessId: connection.businessId });
        return lastMs ?? now - INTERVAL_MS; // the first run looks back one interval
      });
      if (since === null) { result.skipped++; continue; }

      const unread = await newUnreadInbox({ connectionId: connection.id, since, top: 3 });
      const message = unread ? digestMessage(unread.count, unread.latest) : null;
      if (!message) { result.quiet++; continue; }
      const ownerUid = await resolveBusinessOwnerUid(connection.businessId);
      if (!ownerUid) { result.skipped++; continue; }
      await sendOwnerMobilePush({
        ownerUid, ...message,
        data: { type: "email_digest", link: "/dashboard/emails", count: String(unread?.count ?? 0) },
      });
      result.pushed++;
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/email-digest] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email digest run failed." }, { status: 500 });
  }
}
