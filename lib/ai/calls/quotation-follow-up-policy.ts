import {createHash,randomUUID} from "node:crypto";
import {platformTodayIso} from "@/lib/platform/timezone";
import {QUOTATION_FOLLOW_UP_DELAY_MS} from "@/lib/quotations/follow-up-timing";
export const QUOTATION_FOLLOW_UP_CALLS="ai_quotation_followup_calls";
export const quotationFollowUpsEnabled=()=>process.env.AI_SOPHIE_QUOTATION_CALLS_ENABLED==="true" && process.env.AI_SOPHIE_CALLBACK_ENABLED==="true" && process.env.AI_VOICE_CALL_LOGS_ENABLED!=="false";
export function quotationFollowUpFields(enabled:boolean,sent:boolean,now=Date.now()) {
  return {sophieFollowUpEnabled:enabled,sophieFollowUpVersion:randomUUID(),sophieFollowUpSentAt:sent?now:null,
    sophieFollowUpDueAt:enabled&&sent?now+QUOTATION_FOLLOW_UP_DELAY_MS:null,sophieFollowUpStatus:enabled&&sent?"QUEUED":"DISABLED"};
}
export function quotationFingerprint(row:Record<string,unknown>) {
  return createHash("sha256").update(JSON.stringify([row.businessId,row.inspectionRequestId,row.quotationCode,row.customer,row.address,
    row.serviceTitle,row.serviceDescription,row.lineItems,row.subtotalAud,row.finalPriceAud,row.discountAud,row.gstPricing,
    row.depositRequest,row.validUntil,row.notes,row.termsAndConditions],(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest("hex");
}
export function quotationFollowUpIneligibleReason(row:Record<string,unknown>,timezone:string,now=Date.now()):string|null {
  if(row.sophieFollowUpEnabled!==true)return "Sophie follow-up is disabled for this quotation.";
  if(row.status!=="sent")return "Quotation is not sent or was cancelled.";
  if(row.customerDecision)return "The customer already accepted or rejected this quotation.";
  if(row.bookingId||row.invoiceId)return "Quotation was already converted to a job or invoice.";
  if(typeof row.sophieFollowUpVersion!=="string"||typeof row.sophieFollowUpSentAt!=="number"||typeof row.sophieFollowUpDueAt!=="number"||!Number.isFinite(row.sophieFollowUpDueAt)||row.sophieFollowUpDueAt<row.sophieFollowUpSentAt)return "Quotation has no valid saved follow-up schedule.";
  // The persisted send-time schedule is authoritative. A running poller may
  // still have the previous test-delay constant after a Next.js hot reload.
  if(now<row.sophieFollowUpDueAt)return "Waiting for the saved follow-up time.";
  if(typeof row.validUntil==="string"&&row.validUntil&&row.validUntil<platformTodayIso(new Date(now),timezone))return "Quotation expired before the follow-up call.";
  return null;
}
export function quotationFollowUpEligible(row:Record<string,unknown>,timezone:string,now=Date.now()) {
  return quotationFollowUpIneligibleReason(row,timezone,now)===null;
}
export function quotationAttemptMatches(attempt:Record<string,unknown>,quote:Record<string,unknown>,binding:{businessId:string;did:string},number:string|null,now=Date.now()) {
  return !!number && attempt.businessId===binding.businessId && attempt.did===binding.did && attempt.number===number &&
    ["REQUESTED","ANSWERED"].includes(String(attempt.status)) && !attempt.callLogId && typeof attempt.attemptedAt==="number" &&
    now>=attempt.attemptedAt && now-attempt.attemptedAt<15*60000 && quote.businessId===binding.businessId &&
    quote.sophieFollowUpVersion===attempt.version && quotationFingerprint(quote)===attempt.fingerprint;
}
