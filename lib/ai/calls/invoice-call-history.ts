import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";
import {invoiceCallLogMatches} from "./invoice-follow-up-policy";

export const INVOICE_CALL_ATTEMPTS_COLLECTION = "ai_invoice_call_attempts";

export async function recentOverdueInvoiceCalls(businessId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return { calls: [], hasMore: false };
  const overdue = new Set(invoiceIds);
  const attempts = await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).where("businessId", "==", businessId)
    .select("invoiceId", "status", "attemptedAt", "scheduledAt", "customerResponse", "customerResponseAt", "did", "numberKey", "businessId", "reason").get();
  const latest = new Map<string, typeof attempts.docs[number]>();
  for (const attempt of attempts.docs) {
    const invoiceId = attempt.get("invoiceId");
    const at = attempt.get("attemptedAt");
    if (!overdue.has(invoiceId) || typeof at !== "number" || !Number.isFinite(at)) continue;
    if (at > (latest.get(invoiceId)?.get("attemptedAt") ?? 0)) latest.set(invoiceId, attempt);
  }
  const recent = [...latest.values()].sort((a, b) => b.get("attemptedAt") - a.get("attemptedAt")).slice(0, 8);
  if (!recent.length) return { calls: [], hasMore: false };
  const recentById=new Map(recent.map(doc=>[doc.id,doc.data()]));
  const transcripts = await adminDb.collection(CALL_LOGS_COLLECTION).where("businessId", "==", businessId)
    .where("callbackAttemptId", "in", recent.map(doc=>doc.id)).select("businessId","did","callerKey","callbackAttemptId", "transcript", "startedAt", "answered").get();
  const logs = new Map(transcripts.docs.filter(doc=>{const attempt=recentById.get(doc.get("callbackAttemptId"));return attempt&&invoiceCallLogMatches(doc.get("callbackAttemptId"),attempt,doc.data());}).map(doc => [doc.get("callbackAttemptId"), toCallLogDetail(doc.id, doc.data())]));
  return {
    hasMore: latest.size > recent.length,
    calls: recent.map(attempt => {
      const invoiceId = attempt.get("invoiceId") as string;
      const log = logs.get(attempt.id);
      const responses = log?.transcript.filter(turn => turn.speaker === "caller").slice(-8)
        .map(turn => turn.text.slice(0, 350)) ?? [];
      return {
        invoiceId, recordedResponse:attempt.get("customerResponse")??null, reason:attempt.get("reason")??null, responseAt:attempt.get("customerResponseAt")??null, status: attempt.get("status") as string, attemptedAt: attempt.get("attemptedAt") as number,
        scheduledAt: typeof attempt.get("scheduledAt") === "number" ? attempt.get("scheduledAt") as number : null,
        customerResponse: log && responses.length ? {
          callId: log.id, at: log.startedAt ?? attempt.get("attemptedAt") as number, excerpts: responses,
        } : null,
      };
    }),
  };
}
