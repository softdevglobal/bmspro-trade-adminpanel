import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { VoiceBusiness } from "../config";
import { CALL_LOGS_COLLECTION, callLogRetentionDays, callOutcome, type CallLogInput } from "../data/call-logs";

/**
 * Saves one finished call. The document id is the bridge's call id, so a retry
 * can never create a second log. Business and DID come from the verified binding.
 * Returns false when the log already existed.
 */
export async function saveCallLog(binding: VoiceBusiness, input: CallLogInput): Promise<boolean> {
  const endedAt = new Date(input.endedAt);
  const firstCaller = input.transcript.find(turn => turn.speaker === "caller")?.text.trim() ?? null;
  try {
    await adminDb.collection(CALL_LOGS_COLLECTION).doc(input.callId).create({
      businessId: binding.businessId,
      did: binding.did,
      callId: input.callId,
      startedAt: Timestamp.fromDate(new Date(input.startedAt)),
      answeredAt: input.answeredAt ? Timestamp.fromDate(new Date(input.answeredAt)) : null,
      endedAt: Timestamp.fromDate(endedAt),
      durationMs: input.durationMs,
      setupMs: input.setupMs,
      answered: input.answeredAt !== null,
      endReason: input.endReason,
      callerNumber: input.callerNumber,
      tools: input.tools,
      outcomes: input.outcomes,
      outcome: callOutcome(input.outcomes),
      transcript: input.transcript,
      firstCallerLine: firstCaller ? firstCaller.slice(0, 160) : null,
      toolCount: input.tools.length,
      turnCount: input.transcript.length,
      knowledgeSearches: input.tools.filter(tool => tool.name === "search_business_knowledge").length,
      receivedAt: FieldValue.serverTimestamp(),
      // Firestore's TTL policy on expireAt deletes the log after the retention period.
      expireAt: Timestamp.fromMillis(endedAt.getTime() + callLogRetentionDays() * 86_400_000),
    });
    return true;
  } catch (error) {
    if ((error as { code?: number })?.code === 6) return false; // ALREADY_EXISTS: a retry of a saved call
    throw error;
  }
}
