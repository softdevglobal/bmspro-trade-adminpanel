import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {FieldValue,type Transaction} from "firebase-admin/firestore";
import {adminDb} from "@/lib/firebase/admin";
import {invoiceHoldMessage} from "./invoice-follow-up-policy";

/** Local checkout state is a reason to wait, never evidence that money was received. */
export async function invoiceContactBlock(businessId:string,invoiceId:string,row:Record<string,unknown>,tx?:Pick<Transaction,"get">,currentAttemptId?:string):Promise<string|null>{
  const hold=invoiceHoldMessage(row);if(hold)return hold;
  if(typeof row.pendingNoAnswerRetryId==="string"&&row.pendingNoAnswerRetryId!==currentAttemptId){
    if(!/^[a-f0-9]{64}$/.test(row.pendingNoAnswerRetryId))return "The invoice retry needs owner review.";
    const pendingRef=adminDb.collection("ai_invoice_call_attempts").doc(row.pendingNoAnswerRetryId);
    const pending=(await (tx?tx.get(pendingRef):pendingRef.get())).data();
    if(pending?.businessId===businessId&&pending.invoiceId===invoiceId&&["SCHEDULED","REQUESTED","CALLING"].includes(pending.status))return "A no-answer retry is already scheduled or calling. Check Calls → Scheduled calls before requesting another call.";
  }
  const key=createHash("sha256").update(`${businessId}:invoice_payment:${invoiceId}`).digest("hex");
  const ref=adminDb.collection("payment_checkout_targets").doc(key);
  const checkout=(await (tx?tx.get(ref):ref.get())).data();
  if(!checkout||checkout.businessId!==businessId||checkout.targetId!==invoiceId)return null;
  if(typeof checkout.sessionId==="string"&&/^cs_[\w]+$/.test(checkout.sessionId)){
    const receiptRef=adminDb.collection("payment_receipts").doc(checkout.sessionId);
    const receipt=(await (tx?tx.get(receiptRef):receiptRef.get())).data();
    if(receipt?.businessId===businessId&&receipt.targetId===invoiceId&&receipt.reconciliationRequired===true)return "A payment needs reconciliation. Owner review is required before further reminders.";
  }
  return typeof checkout.expiresAt==="number"&&checkout.expiresAt>Date.now()?"A payment checkout is open or being prepared. Wait for it to settle or expire before following up.":null;
}

/** Call this before other transaction writes. Never retry an uncertain dial automatically. */
export async function holdUnverifiedInvoiceCall(tx:Transaction,businessId:string,invoiceId:string,attemptId:string){
  const ref=adminDb.collection("invoices").doc(invoiceId),row=(await tx.get(ref)).data();
  if(!row||row.businessId!==businessId||row.sophieCollectionHold?.active)return;
  tx.update(ref,{sophieCollectionHold:{active:true,id:attemptId,reviewToken:randomUUID(),reason:"call_outcome_unknown",createdAt:Date.now()}});
  tx.set(adminDb.collection("business_notifications").doc(`invoice-followup-${attemptId}`),{
    id:`invoice-followup-${attemptId}`,businessId,invoiceId,requestId:invoiceId,status:"awaiting_decision",type:"invoice_follow_up_review",
    title:"Invoice call needs review",body:`The outcome of the call about ${row.invoiceCode||"this invoice"} could not be verified. Follow-ups are paused. Check call history before resuming.`,read:false,createdAt:FieldValue.serverTimestamp(),
  });
}
