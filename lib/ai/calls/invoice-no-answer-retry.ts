import "server-only";
import {createHash} from "node:crypto";
import type {Transaction} from "firebase-admin/firestore";
import {adminDb} from "@/lib/firebase/admin";
import {mapInvoiceDoc} from "@/lib/invoices/server";
import {resolveInvoicePaymentDue} from "@/lib/invoices/payment-due";
import {parseBusinessModuleSettings} from "@/lib/business/module-settings";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
import {phoneComparisonKey} from "@/lib/users/phone-uniqueness";
import {invoiceContactBlock} from "./invoice-contact-guard";
import {isCustomerCallOptedOut} from "./call-preferences";
import {INVOICE_NO_ANSWER_MAX_RETRIES,INVOICE_NO_ANSWER_RETRY_DELAY_MS} from "@/lib/invoices/follow-up-timing";

/** Call only for a confirmed NO_ANSWER, before any transaction writes. */
export async function scheduleInvoiceNoAnswerRetry(tx:Transaction,businessId:string,invoiceId:string,attemptId:string,now=Date.now()){
  if(process.env.AI_SOPHIE_CALLBACK_ENABLED!=="true"||process.env.AI_SOPHIE_INVOICE_CALLS_ENABLED!=="true")return;
  const retryId=createHash("sha256").update(JSON.stringify(["invoice-no-answer-retry",businessId,invoiceId,attemptId])).digest("hex");
  const scheduledRef=adminDb.collection("ai_scheduled_callbacks").doc(retryId);
  const attemptRef=adminDb.collection("ai_invoice_call_attempts").doc(attemptId);
  const [parent,invoiceDoc,business,existing]=await tx.getAll(attemptRef,adminDb.collection("invoices").doc(invoiceId),adminDb.collection("businesses").doc(businessId),scheduledRef);
  const a=parent.data(),row=invoiceDoc.data(),profile=business.data();
  if(existing.exists||!a||a.businessId!==businessId||a.invoiceId!==invoiceId||!["REQUESTED","NO_ANSWER"].includes(a.status)||typeof a.did!=="string"||!/^\d{6,15}$/.test(a.did)||(a.invoiceRetryCount??0)>=INVOICE_NO_ANSWER_MAX_RETRIES||!row||row.businessId!==businessId||!profile||profile.isActive!==true||profile.status==="suspended"||profile.sophieInvoiceCallsEnabled!==true||!parseBusinessModuleSettings(profile).invoices)return;
  const invoice=mapInvoiceDoc(invoiceId,row),number=normalizeInvoiceCallbackNumber(invoice.customer.phone),numberKey=phoneComparisonKey(number);
  if(!number||!numberKey||numberKey!==a.numberKey||!resolveInvoicePaymentDue(invoice,profile.timezone).isOverdue||await invoiceContactBlock(businessId,invoiceId,row,tx)||await isCustomerCallOptedOut(businessId,number))return;
  const retryAttemptRef=adminDb.collection("ai_invoice_call_attempts").doc(retryId);
  if((await tx.get(retryAttemptRef)).exists)return;
  const scheduledAt=now+INVOICE_NO_ANSWER_RETRY_DELAY_MS;
  tx.create(scheduledRef,{businessId,invoiceId,did:a.did,number,numberKey,customerName:invoice.customer.fullName,purpose:"overdue_invoice",source:"invoice_no_answer_retry",parentAttemptId:attemptId,invoiceRetryCount:1,scheduledAt,status:"SCHEDULED",createdAt:now,updatedAt:now});
  tx.create(retryAttemptRef,{businessId,invoiceId,did:a.did,numberKey,source:"invoice_no_answer_retry",parentAttemptId:attemptId,invoiceRetryCount:1,status:"SCHEDULED",attemptedAt:now,scheduledAt});
  tx.update(attemptRef,{noAnswerRetryId:retryId,noAnswerRetryAt:scheduledAt});
  tx.update(invoiceDoc.ref,{pendingNoAnswerRetryId:retryId});
}
