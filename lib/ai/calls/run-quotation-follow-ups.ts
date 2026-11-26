import "server-only";
import {createHash} from "node:crypto";
import {adminDb} from "@/lib/firebase/admin";
import {getBusinessProfile} from "@/lib/onboarding/server";
import {DID_MAPPINGS_COLLECTION,lookupVoiceDidRoute} from "@/lib/ai/data/did-mappings";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
import {phoneComparisonKey} from "@/lib/users/phone-uniqueness";
import {isCustomerCallOptedOut} from "./call-preferences";
import {isWithinSophieCallingHours} from "./calling-hours";
import {callbackState} from "./callback-state";
import {requestSophieCallback} from "./request-callback";
import {QUOTATION_FOLLOW_UP_CALLS,quotationFingerprint,quotationFollowUpEligible,quotationFollowUpIneligibleReason,quotationFollowUpsEnabled} from "./quotation-follow-up-policy";

export async function runQuotationFollowUps() {
 const counts={processed:0,deferred:0,skipped:0,errors:0};
 if(!quotationFollowUpsEnabled())return counts;
 const deadline=Date.now()+110000;
 const {completeQuotationDecisionEffects}=await import("./quotation-follow-up-actions");
 const pending=await adminDb.collection(QUOTATION_FOLLOW_UP_CALLS).where("decisionEffectsStatus","==","PENDING").limit(5).get();
 for(const doc of pending.docs)await completeQuotationDecisionEffects(doc.id).catch(()=>counts.errors++);
 const due=await adminDb.collection("quotations").where("sophieFollowUpStatus","==","QUEUED")
   .where("sophieFollowUpDueAt","<=",Date.now()).orderBy("sophieFollowUpDueAt","asc").limit(6).get();
 for(const quote of due.docs){
  if(Date.now()>=deadline)break;
  try{
   const row=quote.data(),businessId=row.businessId;
   if(typeof businessId!=="string")continue;
   const profile=await getBusinessProfile(businessId);
   const timezone=profile?.timezone||"Australia/Melbourne";
   const skip=async(reason:string)=>{await adminDb.runTransaction(async tx=>{
    const fresh=await tx.get(quote.ref);
    if(fresh.get("sophieFollowUpStatus")==="QUEUED"&&fresh.get("sophieFollowUpVersion")===row.sophieFollowUpVersion)
      tx.update(quote.ref,{sophieFollowUpStatus:"SKIPPED",sophieFollowUpReason:reason});
   });counts.skipped++;};
   if(!profile?.enabledModules.quotations){await skip("Quotations are unavailable for this business.");continue;}
   const ineligible=quotationFollowUpIneligibleReason(row,timezone);
   if(ineligible==="Waiting for the saved follow-up time."){counts.deferred++;continue;}
   if(ineligible){await skip(ineligible);continue;}
   const number=normalizeInvoiceCallbackNumber(String(row.customer?.phone??""));
   if(!number||!row.customer?.fullName||!row.quotationCode){await skip("A supported customer number, name and quotation reference are required.");continue;}
   if(await isCustomerCallOptedOut(businessId,number)){await skip("Customer opted out of Sophie calls.");continue;}
   if(!isWithinSophieCallingHours(Date.now(),timezone,profile.sophieCallingHours)){counts.deferred++;continue;}
   const mappings=await adminDb.collection(DID_MAPPINGS_COLLECTION).where("businessId","==",businessId).where("isActive","==",true).get();
   const enabled=mappings.docs.filter(doc=>doc.get("callback.callerId")),preferred=enabled.filter(doc=>doc.get("callback.automatic")===true);
   const selected=enabled.length===1?enabled[0]:preferred.length===1?preferred[0]:null;
   if(!selected){await skip("Choose a single automatic outbound business number.");continue;}
   const route=await lookupVoiceDidRoute(selected.id);
   if(route.state!=="active"||route.binding.businessId!==businessId||!route.callback){await skip("Outbound route unavailable.");continue;}
   const customerDids=await Promise.all([number,number.startsWith("0")?`61${number.slice(1)}`:number].map(did=>adminDb.collection(DID_MAPPINGS_COLLECTION).doc(did).get()));
   if(customerDids.some(doc=>doc.exists)){await skip("Customer contact is a reception DID.");continue;}
   const id=createHash("sha256").update(`${businessId}:${quote.id}:${row.sophieFollowUpVersion}`).digest("hex");
   const attempt=adminDb.collection(QUOTATION_FOLLOW_UP_CALLS).doc(id),lease=callbackState(businessId,phoneComparisonKey(number)!);
   const claimed=await adminDb.runTransaction(async tx=>{
    const [current,existing,contact,mapping]=await Promise.all([tx.get(quote.ref),tx.get(attempt),tx.get(lease),tx.get(selected.ref)]);
    const fresh=current.data();
    if(!fresh||fresh.sophieFollowUpStatus!=="QUEUED"||fresh.sophieFollowUpVersion!==row.sophieFollowUpVersion||!quotationFollowUpEligible(fresh,timezone)||quotationFingerprint(fresh)!==quotationFingerprint(row))return false;
    if(existing.exists||Math.max(contact.get("leaseUntil")??0,contact.get("manualLeaseUntil")??0)>Date.now())return false;
    if(mapping.get("businessId")!==businessId||mapping.get("isActive")!==true||!mapping.get("callback.callerId"))return false;
    tx.create(attempt,{businessId,quotationId:quote.id,requestId:row.inspectionRequestId,quotationCode:row.quotationCode,version:row.sophieFollowUpVersion,
      fingerprint:quotationFingerprint(row),did:selected.id,number,numberKey:phoneComparisonKey(number),status:"REQUESTED",attemptedAt:Date.now()});
    tx.update(quote.ref,{sophieFollowUpStatus:"CALLING",sophieFollowUpCallId:id});
    tx.set(lease,{manualLeaseId:id,manualLeaseUntil:Date.now()+15*60000},{merge:true});return true;
   });
   if(!claimed){counts.deferred++;continue;}
   let status="UNKNOWN";
   try{
    const latest=(await quote.ref.get()).data();
    if(!quotationFollowUpsEnabled()||!latest||latest.sophieFollowUpVersion!==row.sophieFollowUpVersion||!quotationFollowUpEligible(latest,timezone)||quotationFingerprint(latest)!==quotationFingerprint(row)||await isCustomerCallOptedOut(businessId,number))status="SKIPPED";
    else {
    const response=await requestSophieCallback({id,did:selected.id,businessId,number,customerName:String(row.customer.fullName).slice(0,120),quotationFollowUp:{quotationCode:row.quotationCode}});
    const result=response.ok?await response.json():null;
    status=response.status===429?"BUSY":!response.ok?(response.status<500?"FAILED":"UNKNOWN"):
      ["ANSWERED","NO_ANSWER","FAILED"].includes(result?.status)?result.status:"UNKNOWN";
    }
   }catch{counts.errors++;}
   await adminDb.runTransaction(async tx=>{
    const [current,contact,call]=await Promise.all([tx.get(quote.ref),tx.get(lease),tx.get(attempt)]);
    if(status==="BUSY")tx.delete(attempt);else tx.update(attempt,{status,...(call.get("decision")?{status:"ANSWERED"}:{})});
    if(current.get("sophieFollowUpVersion")===row.sophieFollowUpVersion&&current.get("sophieFollowUpStatus")==="CALLING")
      tx.update(quote.ref,{sophieFollowUpStatus:status==="BUSY"?"QUEUED":status,...(status==="BUSY"?{sophieFollowUpDueAt:Date.now()+60000}:{})});
    if(contact.get("manualLeaseId")===id&&status!=="ANSWERED"&&status!=="UNKNOWN")tx.update(lease,{manualLeaseUntil:0});
   });
   if(status==="BUSY"){counts.deferred++;break;}counts.processed++;
  }catch{counts.errors++;console.error("[sophie-quotation-calls] Follow-up processing failed",{quotationId:quote.id});}
 }
 return counts;
}
