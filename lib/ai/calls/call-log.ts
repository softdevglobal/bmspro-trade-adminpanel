import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import type { VoiceBusiness } from "../config";
import { CALL_LOGS_COLLECTION, callConversationHighlights, callLogRetentionDays, callOutcome, type CallLogInput } from "../data/call-logs";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import {callbackState} from "./callback-state";

/**
 * Saves one finished call. The document id is the bridge's call id, so a retry
 * can never create a second log. Business and DID come from the verified binding.
 * Returns false when the log already existed.
 */
export async function saveCallLog(binding: VoiceBusiness, input: CallLogInput): Promise<boolean> {
  const endedAt = new Date(input.endedAt);
  const firstCaller = input.transcript.find(turn => turn.speaker === "caller")?.text.trim() ?? null;
  let created = true;
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
      ...(input.callbackAttemptId ? { callbackAttemptId: input.callbackAttemptId } : {}),
      ...(input.quotationFollowUpCall ? {purpose:"quotation_followup"} : {}),
      callerKey: phoneComparisonKey(input.callerNumber),
      tools: input.tools,
      outcomes: input.outcomes,
      outcome: callOutcome(input.outcomes),
      transcript: input.transcript,
      conversationHighlights: callConversationHighlights(input.transcript),
      firstCallerLine: firstCaller ? firstCaller.slice(0, 160) : null,
      toolCount: input.tools.length,
      turnCount: input.transcript.length,
      knowledgeSearches: input.tools.filter(tool => tool.name === "search_business_knowledge").length,
      receivedAt: FieldValue.serverTimestamp(),
      // Firestore's TTL policy on expireAt deletes the log after the retention period.
      expireAt: Timestamp.fromMillis(endedAt.getTime() + callLogRetentionDays() * 86_400_000),
    });
  } catch (error) {
    if ((error as { code?: number })?.code === 6) created = false;
    else throw error;
  }
  // Link the existing transcript instead of copying customer speech into a second,
  // longer-lived record. A retry can repair this link if its first write failed.
  if(input.ownerScheduledCall && input.callbackAttemptId){
    if(!created){
      const saved=(await adminDb.collection(CALL_LOGS_COLLECTION).doc(input.callId).get()).data();
      if(saved?.businessId!==binding.businessId||saved.did!==binding.did||saved.callerKey!==phoneComparisonKey(input.callerNumber)||saved.callbackAttemptId!==input.callbackAttemptId)return false;
    }
    const ref=adminDb.collection("ai_scheduled_callbacks").doc(input.callbackAttemptId);
    await adminDb.runTransaction(async tx=>{
      const snap=await tx.get(ref);const data=snap.data();
      if(!data||!["owner_requested","owner_notification"].includes(data.purpose)||data.businessId!==binding.businessId||data.did!==binding.did||data.numberKey!==phoneComparisonKey(input.callerNumber)||data.callLogId&&data.callLogId!==input.callId)return;
      tx.update(ref,{callLogId:input.callId,conversationEndedAt:endedAt.getTime(),updatedAt:Date.now()});
      if(data.purpose==="owner_notification")tx.update(adminDb.collection(CALL_LOGS_COLLECTION).doc(input.callId),{recipientType:"owner",purpose:"owner_notification"});
    });
  }
  if(input.quotationFollowUpCall && input.callbackAttemptId){
    if(!created){
      const saved=(await adminDb.collection(CALL_LOGS_COLLECTION).doc(input.callId).get()).data();
      if(saved?.businessId!==binding.businessId||saved.did!==binding.did||saved.callerKey!==phoneComparisonKey(input.callerNumber)||saved.callbackAttemptId!==input.callbackAttemptId)return false;
    }
    const ref=adminDb.collection("ai_quotation_followup_calls").doc(input.callbackAttemptId);
    await adminDb.runTransaction(async tx=>{
      const snap=await tx.get(ref),row=snap.data();
      if(!row||row.businessId!==binding.businessId||row.did!==binding.did||row.numberKey!==phoneComparisonKey(input.callerNumber)||row.callLogId&&row.callLogId!==input.callId)return;
      const lease=callbackState(binding.businessId,row.numberKey),currentLease=await tx.get(lease);
      tx.update(ref,{callLogId:input.callId,conversationEndedAt:endedAt.getTime()});
      if(currentLease.get("manualLeaseId")===input.callbackAttemptId)tx.update(lease,{manualLeaseUntil:0});
    });
  }
  return created;
}
