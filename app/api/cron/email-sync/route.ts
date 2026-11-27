import { runAgent } from "@/lib/ai/agent/agent";
import { agentFlags } from "@/lib/ai/agent/config";
import { AGENT_HANDLERS } from "@/lib/ai/agent/handlers";
import { isEmailSendEnabled } from "@/lib/email-integration/config";
import { mapConnectionDoc } from "@/lib/email-integration/connections";
import { syncMailbox } from "@/lib/email-integration/mailbox/sync";
import { EMAIL_CONNECTIONS_COLLECTION } from "@/lib/email-integration/config";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";
import { FieldPath } from "firebase-admin/firestore";
import { after, NextResponse } from "next/server";

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
/** The function stops at 60 s; leave a margin, and skip the kick if there's too little time. */
const KICK_DEADLINE_MS = 55_000;
const KICK_MIN_BUDGET_MS = 10_000;

/**
 * New mail for Sophie: run her now, after the response, rather than waiting up to 5 minutes for
 * the agent-run cron. Safe to overlap with that cron; each event is claimed once.
 */
function kickAgentRun(started: number) {
  const flags = agentFlags();
  const budgetMs = KICK_DEADLINE_MS - (Date.now() - started) - 5_000;
  if (!flags.enabled || budgetMs < KICK_MIN_BUDGET_MS) return;
  after(async () => {
    try {
      await runAgent({ db: adminDb, resolveOwnerUid: resolveBusinessOwnerUid, handlers: AGENT_HANDLERS, flags }, { budgetMs });
    } catch (error) {
      console.error("[cron/email-sync] agent run failed", (error as Error)?.name);
    }
  });
}

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
    let triageQueued = 0;
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
      if (outcome.ok) triageQueued += outcome.triageQueued;
    }
    if (triageQueued > 0) kickAgentRun(started);
    return NextResponse.json({ ok: true, mailboxes, results, triageQueued });
  } catch (error) {
    console.error("[cron/email-sync] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email sync run failed." }, { status: 500 });
  }
}
