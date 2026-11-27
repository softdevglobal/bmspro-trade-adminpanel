import "server-only";
import {randomUUID} from "node:crypto";
import {adminDb} from "@/lib/firebase/admin";
import {FieldValue} from "firebase-admin/firestore";
import {mapInvoiceDoc} from "@/lib/invoices/server";
import {resolveInvoicePaymentDue} from "@/lib/invoices/payment-due";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
import {phoneComparisonKey} from "@/lib/users/phone-uniqueness";
import {invoiceContactBlock} from "./invoice-contact-guard";
import {invoiceResponseInput,INVOICE_RESPONSE_LABELS,type InvoiceCustomerResponse} from "./invoice-follow-up-policy";
import {parseBusinessModuleSettings} from "@/lib/business/module-settings";

type Binding={businessId:string;did:string};
async function context(binding:Binding,id:string,number:string|null){
  const ref=adminDb.collection("ai_invoice_call_attempts").doc(id),row=(await ref.get()).data();
  const numberKey=phoneComparisonKey(number?normalizeInvoiceCallbackNumber(number):null);
  if(!row||row.businessId!==binding.businessId||row.did!==binding.did||!numberKey||row.numberKey!==numberKey||typeof row.invoiceId!=="string"||!/^[\w-]{1,128}$/.test(row.invoiceId)||!["REQUESTED","ANSWERED","UNKNOWN"].includes(row.status))return null;
  const business=(await adminDb.collection("businesses").doc(binding.businessId).get()).data();
  if(typeof row.attemptedAt!=="number"||Date.now()-row.attemptedAt>2*3600000||row.attemptedAt>Date.now()+60000||row.conversationEndedAt&&!row.customerResponse)return null;
  if(!business||business.isActive!==true||business.status==="suspended"||business.sophieInvoiceCallsEnabled!==true||!parseBusinessModuleSettings(business).invoices)return null;
  return {ref,row,numberKey,business,invoiceRef:adminDb.collection("invoices").doc(row.invoiceId)};
}
function matches(row:Record<string,unknown>|undefined,binding:Binding,key:string){
  return row?.businessId===binding.businessId&&phoneComparisonKey(normalizeInvoiceCallbackNumber(String((row.customer as {phone?:string})?.phone||"")))===key;
}
export async function readFollowUpInvoice(binding:Binding,id:string,number:string|null){
  const found=await context(binding,id,number);if(!found)return {status:"UNAVAILABLE"};
  return adminDb.runTransaction(async tx=>{
    const [invoice,attempt]=await tx.getAll(found.invoiceRef,found.ref),row=invoice.data();
    if(!row||!matches(row,binding,found.numberKey)||attempt.get("numberKey")!==found.numberKey||attempt.get("businessId")!==binding.businessId||attempt.get("did")!==binding.did||attempt.get("invoiceId")!==invoice.id)return {status:"UNAVAILABLE"};
    const mapped=mapInvoiceDoc(invoice.id,row),due=resolveInvoicePaymentDue(mapped,found.business.timezone);
    const block=await invoiceContactBlock(binding.businessId,invoice.id,row,tx,id);
    if(block||!due.isOverdue)return {status:"STOP",message:block||"This invoice is no longer overdue. Do not request payment."};
    tx.update(found.ref,{detailsReadAt:Date.now()});
    return {status:"OK",invoice:{reference:mapped.invoiceCode,service:mapped.serviceTitle,dueDate:mapped.dueDate,outstandingAud:due.outstandingAud,currency:"AUD"}};
  });
}
export async function recordInvoiceCustomerResponse(binding:Binding,id:string,number:string|null,raw:unknown){
  const parsed=invoiceResponseInput.safeParse(raw);if(!parsed.success)return {status:"REJECTED"};
  const found=await context(binding,id,number);if(!found)return {status:"UNAVAILABLE"};
  const response=parsed.data;
  return adminDb.runTransaction(async tx=>{
    const [invoice,attempt]=await tx.getAll(found.invoiceRef,found.ref),row=invoice.data(),a=attempt.data();
    if(!row||!a||!matches(row,binding,found.numberKey)||a.numberKey!==found.numberKey||a.businessId!==binding.businessId||a.did!==binding.did||a.invoiceId!==invoice.id||response.outcome!=="wrong_person"&&!a.detailsReadAt)return {status:"REJECTED"};
    if(a.customerResponse)return JSON.stringify(a.customerResponse)===JSON.stringify(response)?{status:"RECORDED",paused:row.sophieCollectionHold?.active===true}:{status:"REJECTED"};
    const hold={active:true,id,reviewToken:randomUUID(),reason:response.outcome,createdAt:Date.now(),...(response.promisedDate?{promisedDate:response.promisedDate}:{}),...(response.outcome==="wrong_person"?{destinationKey:found.numberKey}:{})};
    tx.update(found.ref,{customerResponse:response,customerResponseAt:Date.now()});
    tx.update(found.invoiceRef,{sophieCollectionHold:hold});
    tx.set(adminDb.collection("business_notifications").doc(`invoice-followup-${id}`),{
      id:`invoice-followup-${id}`,businessId:binding.businessId,type:"invoice_follow_up_review",title:"Invoice follow-up needs review",
      body:`${row.invoiceCode||"Invoice"}: ${INVOICE_RESPONSE_LABELS[response.outcome]}${response.promisedDate?` (${response.promisedDate})`:""}. Response recorded; payment records unchanged.`,
      invoiceId:invoice.id,requestId:invoice.id,status:"awaiting_decision",customerName:row.customer?.fullName||"Customer",callbackAttemptId:id,read:false,createdAt:FieldValue.serverTimestamp(),
    });
    return {status:"RECORDED",paused:true};
  });
}
export type {InvoiceCustomerResponse};
