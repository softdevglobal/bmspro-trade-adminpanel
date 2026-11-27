import {invoiceContactBlock,holdUnverifiedInvoiceCall} from "./invoice-contact-guard";
import {scheduleInvoiceNoAnswerRetry} from "./invoice-no-answer-retry";
import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { INVOICE_COLLECTION, mapInvoiceDoc } from "@/lib/invoices/server";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";
import { DID_MAPPINGS_COLLECTION, lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { callbackResultStatus, callbackState } from "./callback-state";
import { normalizeInvoiceCallbackNumber } from "./callback-number";
import { INVOICE_CALL_ATTEMPTS_COLLECTION } from "./invoice-call-history";
import { requestSophieCallback,callbackTransportCode } from "./request-callback";
import { isCustomerCallOptedOut } from "./call-preferences";
import { isWithinSophieCallingHours } from "./calling-hours";

export async function runOverdueInvoiceCalls() {
  const counts = { processed: 0, deferred: 0, errors: 0 };
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true" || process.env.AI_SOPHIE_INVOICE_CALLS_ENABLED !== "true") return counts;
  const deadline = Date.now() + 110_000;
  const queue = await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).where("status", "==", "QUEUED").limit(20).get();
  for (const attempt of queue.docs.sort((a, b) => a.get("queuedAt") - b.get("queuedAt"))) {
    if (Date.now() >= deadline) break;
    const { businessId, invoiceId } = attempt.data();
    if (typeof businessId !== "string" || typeof invoiceId !== "string") continue;
    const invoiceRef = adminDb.collection(INVOICE_COLLECTION).doc(invoiceId);
    const skip = async (reason: string) => {
      await adminDb.runTransaction(async tx => {
        if ((await tx.get(attempt.ref)).get("status") === "QUEUED") tx.update(attempt.ref, { status: "SKIPPED", reason });
      });
    };
    try {
      const [profile, mappings] = await Promise.all([
        getBusinessProfile(businessId),
        adminDb.collection(DID_MAPPINGS_COLLECTION).where("businessId", "==", businessId)
          .where("isActive", "==", true).get(),
      ]);
      if (!profile?.enabledModules.invoices) { await skip("Invoices are unavailable for this business."); continue; }
      if (!profile.sophieInvoiceCallsEnabled) { await skip("The business owner has not enabled Sophie invoice calls."); continue; }
      const enabled = mappings.docs.filter(doc => doc.get("callback.callerId"));
      const preferred = enabled.filter(doc => doc.get("callback.automatic") === true);
      const selected = enabled.length === 1 ? enabled[0] : preferred.length === 1 ? preferred[0] : null;
      if (!selected) { await skip("Choose a single business number for automatic callbacks in DID mappings."); continue; }
      const did = selected.id;
      const route = await lookupVoiceDidRoute(did);
      if (route.state !== "active" || route.binding.businessId !== businessId || !route.callback) {
        await skip("The business calling number is unavailable.");
        continue;
      }
      const call = await adminDb.runTransaction(async tx => {
        const [queued, invoiceDoc, mapping] = await tx.getAll(attempt.ref, invoiceRef, selected.ref);
        if (queued.get("status") !== "QUEUED") return null;
        if (mapping.get("businessId") !== businessId || mapping.get("isActive") !== true || !mapping.get("callback.callerId")) {
          tx.update(attempt.ref, { status: "SKIPPED", reason: "The business calling number is unavailable." });
          return null;
        }
        const data = invoiceDoc.data();
        const invoice = data?.businessId === businessId ? mapInvoiceDoc(invoiceId, data) : null;
        if (!invoice || data?.overdueReminderCallId !== attempt.id || !resolveInvoicePaymentDue(invoice, profile.timezone).isOverdue) {
          tx.update(attempt.ref, { status: "SKIPPED", reason: "The invoice was settled, changed, or has a newer reminder." });
          return null;
        }
        if (data?.remindersPause) {
          tx.update(attempt.ref, { status: "SKIPPED", reason: "Reminders are paused: the customer says they've paid or disputes it." });
          return null;
        }
        const block=await invoiceContactBlock(businessId,invoiceId,data!,tx);
        if(block){tx.update(attempt.ref,{status:"SKIPPED",reason:block});return null;}
        const number = normalizeInvoiceCallbackNumber(invoice.customer.phone);
        const customerName = invoice.customer.fullName.trim().slice(0, 120);
        const key = phoneComparisonKey(number);
        if (!number || !key || !customerName || number === did) {
          tx.update(attempt.ref, { status: "SKIPPED", reason: "The invoice needs a customer name and supported phone number." });
          return null;
        }
        if (await isCustomerCallOptedOut(businessId, number)) {
          tx.update(attempt.ref, { status: "SKIPPED", reason: "Customer opted out of Sophie calls." });
          return null;
        }
        if (!isWithinSophieCallingHours(Date.now(), profile.timezone ?? "Australia/Melbourne", profile.sophieCallingHours)) {
          return null;
        }
        const lease = callbackState(businessId, key);
        const state = await tx.get(lease);
        const now = Date.now();
        if (Math.max(state.get("manualLeaseUntil") ?? 0, state.get("leaseUntil") ?? 0) > now) return null;
        tx.update(attempt.ref, { status: "REQUESTED", did, numberKey:key, attemptedAt: now });
        tx.set(lease, { manualLeaseId: attempt.id, manualLeaseUntil: now + 60_000 }, { merge: true });
        return { number, customerName, lease };
      });
      if (!call) continue;
      let status = "UNKNOWN";
      let reason: string | null = null;
      try {
        const response = await requestSophieCallback({ id: attempt.id, did, businessId,
          number: call.number, customerName: call.customerName });
        const result = response.ok ? await response.json() : null;
        status = response.status === 429 ? "QUEUED" : response.ok
          ? callbackResultStatus(result?.status) : response.status < 500 ? "FAILED" : "UNKNOWN";
        if (status === "FAILED" || status === "UNKNOWN") {
          reason = typeof result?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(result.code)
            ? result.code : response.ok ? "Bridge did not confirm the call outcome." : `Bridge returned HTTP ${response.status}.`;
        }
        if (status === "QUEUED") counts.deferred++;
        else counts.processed++;
      } catch (error) {
        reason = `Could not verify the voice bridge response (${callbackTransportCode(error)}).`;
        console.error("[sophie-invoice-calls] Bridge request unverified",{attemptId:attempt.id.slice(0,8),code:callbackTransportCode(error)});
        counts.errors++;
      } finally {
        await adminDb.runTransaction(async tx => {
          const lease = await tx.get(call.lease);
          if(status==="UNKNOWN")await holdUnverifiedInvoiceCall(tx,businessId,invoiceId,attempt.id);
          if(status==="NO_ANSWER")await scheduleInvoiceNoAnswerRetry(tx,businessId,invoiceId,attempt.id);
          tx.update(attempt.ref, { status, reason });
          if (lease.get("manualLeaseId") === attempt.id && status !== "UNKNOWN") tx.update(call.lease, { manualLeaseUntil: 0 });
        });
      }
      if (status === "QUEUED") break;
    } catch {
      counts.errors++;
      console.error("[sophie-invoice-calls] Could not process overdue reminder call", { invoiceId });
    }
  }
  return counts;
}
