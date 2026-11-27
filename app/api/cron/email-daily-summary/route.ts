import { EMAILS_SOPHIE_LINK } from "@/lib/ai/email/cards";
import { complaintTypeLabel, listOpenCases } from "@/lib/ai/email/complaints/cases";
import { EMAIL_SETTINGS_COLLECTION, emailComplaintsEnabled, emailTriageAvailable, mapEmailSettings } from "@/lib/ai/email/settings";
import {
  buildDailySummary,
  EMAIL_SUMMARIES_COLLECTION,
  summaryDue,
  type SummaryRow,
} from "@/lib/ai/email/summary";
import { EMAIL_TRIAGE_COLLECTION } from "@/lib/ai/email/triage";
import type { EmailTriageResult } from "@/lib/ai/email/types";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid, sendOwnerMobilePush } from "@/lib/notifications/push";
import { PLATFORM_TIME_ZONE, resolvePlatformTimeZone } from "@/lib/platform/timezone";
import { Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60_000;
const SUMMARY_TTL_MS = 90 * DAY_MS;
const MAX_BUSINESSES_PER_RUN = 500;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (request.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

function toRow(doc: QueryDocumentSnapshot): SummaryRow {
  const data = doc.data();
  const result = (data.result ?? null) as EmailTriageResult | null;
  const sender = (data.sender ?? null) as { name?: unknown; address?: unknown } | null;
  return {
    id: doc.id,
    status: data.status,
    precheck: typeof data.precheck === "string" ? data.precheck : "none",
    kind: result?.kind ?? null,
    friendlyType: result?.friendlyType ?? null,
    senderName: typeof sender?.name === "string" ? sender.name : null,
    senderAddress: typeof sender?.address === "string" ? sender.address : null,
    subject: typeof data.subject === "string" ? data.subject : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
    spotCheck: data.spotCheck === true,
  };
}

/**
 * Every hour: Sophie's daily email summary (docs/sophie-email-learning-and-auto-reply.md §6.4), sent
 * to each business once per local day at or after its chosen hour (default 5 pm). A transaction
 * claims each local day once, so overlapping runs and daylight-saving changes can't send it twice (T18).
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!emailTriageAvailable()) return NextResponse.json({ ok: true, skipped: "disabled" });

  try {
    const snap = await adminDb.collection(EMAIL_SETTINGS_COLLECTION)
      .where("enabled", "==", true)
      .limit(MAX_BUSINESSES_PER_RUN)
      .get();
    const result = { businesses: 0, sent: 0, quiet: 0, notDue: 0 };
    const started = Date.now();
    for (const doc of snap.docs) {
      if (Date.now() - started >= 50_000) break;
      const settings = mapEmailSettings(doc.data());
      if (!settings.enabled) continue;
      result.businesses++;
      const businessId = doc.id;
      const now = Date.now();

      const business = (await adminDb.collection("businesses").doc(businessId).get()).data();
      let timeZone = resolvePlatformTimeZone(typeof business?.timezone === "string" ? business.timezone : null);
      let due: ReturnType<typeof summaryDue>;
      try {
        due = summaryDue(now, timeZone, settings.summaryHour, settings.lastSummaryDate);
      } catch {
        timeZone = PLATFORM_TIME_ZONE;
        due = summaryDue(now, timeZone, settings.summaryHour, settings.lastSummaryDate);
      }
      if (!due.due) { result.notDue++; continue; }

      const since = await adminDb.runTransaction(async (tx) => {
        const current = mapEmailSettings((await tx.get(doc.ref)).data());
        if (current.lastSummaryDate === due.dateKey) return null;
        tx.set(doc.ref, { lastSummaryDate: due.dateKey, lastSummaryAt: Timestamp.fromMillis(now) }, { merge: true });
        return current.lastSummaryAt ?? now - DAY_MS;
      });
      if (since === null) continue;

      const triage = adminDb.collection(EMAIL_TRIAGE_COLLECTION);
      const [recent, waiting] = await Promise.all([
        triage.where("businessId", "==", businessId).where("createdAt", ">", Timestamp.fromMillis(since))
          .orderBy("createdAt", "desc").limit(1000).get(),
        triage.where("businessId", "==", businessId).where("status", "==", "new")
          .orderBy("createdAt", "desc").limit(100).get(),
      ]);
      const ours = (doc: QueryDocumentSnapshot) => doc.data().businessId === businessId;
      const complaints = emailComplaintsEnabled() ? await listOpenCases(adminDb, businessId).catch(() => []) : [];
      const summary = buildDailySummary({
        complaints: complaints.map((item) => ({ id: item.id, typeLabel: complaintTypeLabel(item.type), customerName: item.customerName, status: item.status, replyBy: item.replyBy })),
        recent: recent.docs.filter(ours).map(toRow),
        waiting: waiting.docs.filter(ours).map(toRow).filter((row) => row.precheck !== "blocked"),
        now,
        timeZone,
      });
      await adminDb.collection(EMAIL_SUMMARIES_COLLECTION).doc(`${businessId}_${summary.dateKey}`).set({
        businessId,
        dateKey: summary.dateKey,
        summary,
        createdAt: Timestamp.fromMillis(now),
        expireAt: Timestamp.fromMillis(now + SUMMARY_TTL_MS),
      });
      if (!summary.push) { result.quiet++; continue; }
      const ownerUid = await resolveBusinessOwnerUid(businessId);
      if (!ownerUid) continue;
      await sendOwnerMobilePush({
        ownerUid,
        ...summary.push,
        data: { type: "email_summary", link: EMAILS_SOPHIE_LINK },
      });
      result.sent++;
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/email-daily-summary] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Email summary run failed." }, { status: 500 });
  }
}
