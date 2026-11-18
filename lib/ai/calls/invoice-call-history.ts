import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";

export const INVOICE_CALL_ATTEMPTS_COLLECTION = "ai_invoice_call_attempts";

export async function recentOverdueInvoiceCalls(businessId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return { calls: [], hasMore: false };
  const overdue = new Set(invoiceIds);
  const attempts = await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).where("businessId", "==", businessId)
    .select("invoiceId", "status", "attemptedAt", "scheduledAt").get();
  const latest = new Map<string, typeof attempts.docs[number]>();
  const lastAnswered = new Map<string, typeof attempts.docs[number]>();
  for (const attempt of attempts.docs) {
    const invoiceId = attempt.get("invoiceId");
    const at = attempt.get("attemptedAt");
    if (!overdue.has(invoiceId) || typeof at !== "number" || !Number.isFinite(at)) continue;
    if (at > (latest.get(invoiceId)?.get("attemptedAt") ?? 0)) latest.set(invoiceId, attempt);
    if (attempt.get("status") === "ANSWERED" && at > (lastAnswered.get(invoiceId)?.get("attemptedAt") ?? 0)) {
      lastAnswered.set(invoiceId, attempt);
    }
  }
  const recent = [...latest.values()].sort((a, b) => b.get("attemptedAt") - a.get("attemptedAt")).slice(0, 8);
  if (!recent.length) return { calls: [], hasMore: false };
  const answeredIds = recent.flatMap(attempt => {
    const answered = lastAnswered.get(attempt.get("invoiceId"));
    return answered ? [answered.id] : [];
  });
  const transcripts = answeredIds.length ? await adminDb.collection(CALL_LOGS_COLLECTION).where("businessId", "==", businessId)
    .where("callbackAttemptId", "in", answeredIds).select("callbackAttemptId", "transcript", "startedAt", "answered").get() : null;
  const logs = new Map(transcripts?.docs.map(doc => [doc.get("callbackAttemptId"), toCallLogDetail(doc.id, doc.data())]));
  return {
    hasMore: latest.size > recent.length,
    calls: recent.map(attempt => {
      const invoiceId = attempt.get("invoiceId") as string;
      const answered = lastAnswered.get(invoiceId);
      const log = answered ? logs.get(answered.id) : undefined;
      const responses = log?.transcript.filter(turn => turn.speaker === "caller").slice(-8)
        .map(turn => turn.text.slice(0, 350)) ?? [];
      return {
        invoiceId, status: attempt.get("status") as string, attemptedAt: attempt.get("attemptedAt") as number,
        scheduledAt: typeof attempt.get("scheduledAt") === "number" ? attempt.get("scheduledAt") as number : null,
        customerResponse: log && responses.length && answered ? {
          callId: log.id, at: log.startedAt ?? answered.get("attemptedAt") as number, excerpts: responses,
        } : null,
      };
    }),
  };
}
