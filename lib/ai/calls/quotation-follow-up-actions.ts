import "server-only";
import {adminDb} from "@/lib/firebase/admin";
import {FieldValue} from "firebase-admin/firestore";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
import {isCustomerCallOptedOut} from "./call-preferences";
import {QUOTATION_FOLLOW_UP_CALLS,quotationAttemptMatches,quotationFollowUpEligible,quotationFollowUpsEnabled} from "./quotation-follow-up-policy";

type Binding={businessId:string;did:string};
async function context(binding:Binding,id:string,number:string|null) {
 if(!quotationFollowUpsEnabled())return null;
 const ref=adminDb.collection(QUOTATION_FOLLOW_UP_CALLS).doc(id),attempt=await ref.get(),row=attempt.data();
 if(!row||typeof row.quotationId!=="string")return null;
 const quoteRef=adminDb.collection("quotations").doc(row.quotationId);
 const [quote,business]=await Promise.all([quoteRef.get(),adminDb.collection("businesses").doc(binding.businessId).get()]);
 const data=quote.data(),businessData=business.data();
 const normalized=number?normalizeInvoiceCallbackNumber(number):null;
 if(!data||!businessData||businessData.isActive!==true||businessData.status==="suspended"||!quotationAttemptMatches(row,data,binding,normalized))return null;
 if(!row.decision&&(!quotationFollowUpEligible(data,businessData.timezone||"Australia/Melbourne")||await isCustomerCallOptedOut(binding.businessId,normalized!)))return null;
 return {ref,row,quoteRef,data,business:businessData};
}
export async function readFollowUpQuotation(binding:Binding,id:string,number:string|null) {
 const found=await context(binding,id,number);
 if(!found||found.row.decision)return {status:"UNAVAILABLE"};
 const q=found.data;
 await found.ref.update({detailsReadAt:Date.now()});
 return {status:"OK",quotation:{reference:q.quotationCode,service:q.serviceTitle,description:q.serviceDescription||null,
  lineItems:Array.isArray(q.lineItems)?q.lineItems.slice(0,30):[],partialLineItems:Array.isArray(q.lineItems)&&q.lineItems.length>30,
  subtotalAud:q.subtotalAud,totalAud:q.finalPriceAud,discountAud:q.discountAud||0,gstPricing:q.gstPricing,
  depositRequest:q.depositRequest||null,validUntil:q.validUntil||null,notes:q.notes||null,termsAndConditions:q.termsAndConditions||null}};
}
export async function recordFollowUpQuotationDecision(binding:Binding,id:string,number:string|null,decision:"accepted"|"rejected") {
 const found=await context(binding,id,number);
 if(!found)return {status:"UNAVAILABLE"};
 const requestRef=adminDb.collection("requests").doc(String(found.data.inspectionRequestId));
 return adminDb.runTransaction(async tx=>{
  const [quote,attempt,request]=await Promise.all([tx.get(found.quoteRef),tx.get(found.ref),tx.get(requestRef)]);
  const q=quote.data(),a=attempt.data(),r=request.data();
  if(!q||!a||!r||!quotationAttemptMatches(a,q,binding,number?normalizeInvoiceCallbackNumber(number):null))return {status:"REJECTED"};
  if(a.decision)return a.decision===decision&&q.customerDecision===decision?{status:"RECORDED",decision,quotationId:quote.id}:{status:"REJECTED"};
  if(!quotationFollowUpEligible(q,found.business.timezone||"Australia/Melbourne")||!a.detailsReadAt||r.businessId!==binding.businessId||r.quotation?.id!==quote.id||r.bookingId||r.status==="cancelled"||r.quotation?.customerDecision)return {status:"REJECTED"};
  const now=FieldValue.serverTimestamp(),decisionFields={customerDecision:decision,customerDecisionAt:now};
  tx.update(found.quoteRef,{...decisionFields,customerDecisionSource:"sophie_follow_up",customerDecisionCallId:id,sophieFollowUpStatus:"DECIDED",updatedAt:now});
  tx.update(requestRef,{"quotation.customerDecision":decision,"quotation.customerDecisionAt":now,updatedAt:now});
  tx.update(found.ref,{decision,decisionAt:Date.now(),decisionEffectsStatus:"PENDING"});
  const notificationId=`quotation-followup-${id}`;
  tx.set(adminDb.collection("business_notifications").doc(notificationId),{
   id:notificationId,businessId:binding.businessId,requestId:request.id,customerName:q.customer?.fullName||"Customer",
   type:decision==="accepted"?"quotation_accepted":"quotation_rejected",title:decision==="accepted"?"Quotation accepted":"Quotation rejected",
   body:`${q.customer?.fullName||"The customer"} ${decision} quotation ${q.quotationCode} during Sophie's follow-up call.`,
   read:false,createdAt:now,quotationId:quote.id,callbackAttemptId:id,
  });
  return {status:"RECORDED",decision,quotationId:quote.id};
 });
}

/** Retryable post-decision work; the owner's portal notification is already atomic. */
export async function completeQuotationDecisionEffects(id:string) {
 const ref=adminDb.collection(QUOTATION_FOLLOW_UP_CALLS).doc(id);
 const row=await adminDb.runTransaction(async tx=>{
  const snap=await tx.get(ref),data=snap.data();
  if(!data||data.decisionEffectsStatus!=="PENDING"||(data.decisionEffectsLeaseUntil??0)>Date.now())return null;
  tx.update(ref,{decisionEffectsLeaseUntil:Date.now()+5*60000});return data;
 });
 if(!row)return;
 try {
 if(row.decision==="accepted"){
  const {draftAcceptedQuotationInvoice}=await import("@/lib/ai/mcp/tools/invoice.tools");
  const result=await draftAcceptedQuotationInvoice(row.businessId,row.quotationId);
  if(result.status==="REJECTED")throw Error("Invoice draft requires review.");
 }
 const {notifyBusinessNotificationsChanged}=await import("@/lib/notifications/realtime-hub");
 notifyBusinessNotificationsChanged(row.businessId);
 const {resolveBusinessOwnerUid,sendOwnerMobilePush}=await import("@/lib/notifications/push");
 const uid=await resolveBusinessOwnerUid(row.businessId);
 if(uid)await sendOwnerMobilePush({ownerUid:uid,title:row.decision==="rejected"?"Quotation rejected":"Quotation accepted",
  body:`Quotation ${row.quotationCode} was ${row.decision} during Sophie's follow-up call.`,
  data:{type:row.decision==="rejected"?"quotation_rejected":"quotation_accepted",requestId:row.requestId,notificationId:`quotation-followup-${id}`}});
 await ref.update({decisionEffectsStatus:"DONE",decisionEffectsLeaseUntil:0});
 }catch{
  const retries=(typeof row.decisionEffectsRetries==="number"?row.decisionEffectsRetries:0)+1;
  await ref.update({decisionEffectsRetries:retries,decisionEffectsLeaseUntil:0,decisionEffectsStatus:retries>=3?"REVIEW":"PENDING"});
  throw Error("Quotation decision follow-up needs retry or staff review.");
 }
}
