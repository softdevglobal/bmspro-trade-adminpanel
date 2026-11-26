import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { INVOICE_COLLECTION, mapInvoiceDoc } from "@/lib/invoices/server";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { normalizeInvoiceCallbackNumber } from "./callback-number";
import { callbackResultStatus, resolveCallback, saveCallbackAttempt } from "./callback-state";
import { INVOICE_CALL_ATTEMPTS_COLLECTION } from "./invoice-call-history";
import { requestSophieCallback } from "./request-callback";
import { isCustomerCallOptedOut } from "./call-preferences";
import { isWithinSophieCallingHours } from "./calling-hours";
import { loadDueScheduledCallbacks } from "./due-scheduled-callbacks";
import {ownerCallRecordInput,ownerScheduledCallsEnabled} from "@/lib/ai/owner-call/owner-scheduled-calls";
import {OWNER_CALL_SETTINGS,validateDueOwnerNotification} from "./owner-notifications";

export async function runScheduledSophieCallbacks({ busyRetryMs = 5 * 60_000 } = {}) {
  const counts = { processed: 0, deferred: 0, skipped: 0, errors: 0 };
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true") return counts;

  const now = Date.now();
  const due = await loadDueScheduledCallbacks(adminDb, now);
  for (const doc of due) {
    const data = doc.data();
    if (typeof data.scheduledAt !== "number" || data.scheduledAt > now) continue;
    const { businessId, did, number, numberKey, purpose, invoiceId, customerName } = data;
    const pendingStatus=purpose==="owner_notification"?"OWNER_SCHEDULED":purpose==="owner_requested"&&data.recipientSource==="owner_number"?"OWNER_NUMBER_SCHEDULED":"SCHEDULED";
    if (typeof businessId !== "string" || typeof did !== "string" || typeof number !== "string" ||
        typeof numberKey !== "string" || !["missed_call", "overdue_invoice", "owner_requested", "owner_notification"].includes(purpose)) {
      await doc.ref.update({ status: "FAILED", reason: "Invalid scheduled callback." });
      counts.errors++;
      continue;
    }

    const [route, profile] = await Promise.all([
      lookupVoiceDidRoute(did), getBusinessProfile(businessId),
    ]);
    if (route.state !== "active" || route.binding.businessId !== businessId || !route.callback?.callerId || !profile) {
      await doc.ref.update({ status: "SKIPPED", reason: "Business callback route is unavailable.", updatedAt: Date.now() });
      if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
        .set({ status: "SKIPPED", reason: "Business callback route is unavailable." }, { merge: true });
      counts.skipped++;
      continue;
    }

    if (purpose === "owner_notification") {
      const reason = await validateDueOwnerNotification(data, route.business.ownerUid);
      if (reason) { await doc.ref.update({ status: "CANCELLED", reason, updatedAt: Date.now() }); counts.skipped++; continue; }
    }
    if (purpose !== "owner_notification" && await isCustomerCallOptedOut(businessId, number)) {
      await doc.ref.update({ status: "CANCELLED", reason: "Customer opted out of Sophie calls.", updatedAt: Date.now() });
      if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
        .set({ status: "CANCELLED", reason: "Customer opted out of Sophie calls." }, { merge: true });
      counts.skipped++;
      continue;
    }
    if(purpose==="owner_requested"){
      const details=ownerCallRecordInput.safeParse(data);
      const direct=details.success&&details.data.recipientSource==="owner_number";
      const customer=details.success&&!direct&&details.data.customerId?(await adminDb.collection("customers").doc(details.data.customerId).get()).data():null;
      const directAllowed=direct&&normalizeInvoiceCallbackNumber(number)===number&&await (await import("./owner-number-destination")).isDirectOwnerCallNumberAllowed(number);
      const expired=Date.now()>(typeof data.expiresAt==="number"?data.expiresAt:(data.originalScheduledAt??data.scheduledAt)+2*3600000);
      if(!details.success||!ownerScheduledCallsEnabled()||route.business.ownerUid!==data.requestedBy||process.env.AI_VOICE_CALL_LOGS_ENABLED==="false"||(!direct&&(!customer||customer.registeredBusinessId!==businessId||normalizeInvoiceCallbackNumber(String(customer.phone??""))!==number||customer.fullName!==customerName))||(direct&&!directAllowed)||expired){
        await doc.ref.update({status:"CANCELLED",reason:expired?"Scheduled call window expired.":"Owner calls disabled or customer contact changed.",updatedAt:Date.now()});counts.skipped++;continue;
      }
    }
    if (purpose === "overdue_invoice" &&
        (process.env.AI_SOPHIE_INVOICE_CALLS_ENABLED !== "true" || !profile.sophieInvoiceCallsEnabled)) {
      await doc.ref.update({ status: "CANCELLED", reason: "Invoice calls are disabled for this business.", updatedAt: Date.now() });
      await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
        .set({ status: "CANCELLED", reason: "Invoice calls are disabled for this business." }, { merge: true });
      counts.skipped++;
      continue;
    }
    if (!isWithinSophieCallingHours(Date.now(), profile.timezone ?? "Australia/Melbourne", profile.sophieCallingHours)) {
      const retryAt = Date.now() + 5 * 60_000;
      await doc.ref.update({ scheduledAt: retryAt, updatedAt: Date.now(), reason: "Waiting for business calling hours." });
      if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
        .set({ status: "SCHEDULED", scheduledAt: retryAt, reason: "Waiting for business calling hours." }, { merge: true });
      counts.deferred++;
      continue;
    }

    if (purpose === "overdue_invoice") {
      if (typeof invoiceId !== "string") {
        await doc.ref.update({ status: "FAILED", reason: "Invoice reference is missing.", updatedAt: Date.now() });
        counts.errors++;
        continue;
      }
      const invoiceDoc = await adminDb.collection(INVOICE_COLLECTION).doc(invoiceId).get();
      const invoiceData = invoiceDoc.data();
      const invoice = invoiceData?.businessId === businessId ? mapInvoiceDoc(invoiceDoc.id, invoiceData) : null;
      const currentNumber = invoice ? normalizeInvoiceCallbackNumber(invoice.customer.phone) : null;
      if (!invoice || !currentNumber || phoneComparisonKey(currentNumber) !== numberKey ||
          !resolveInvoicePaymentDue(invoice, profile.timezone).isOverdue) {
        await doc.ref.update({ status: "CANCELLED", reason: "Invoice is no longer overdue or its contact changed.", updatedAt: Date.now() });
        await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
          .set({ status: "CANCELLED", reason: "Invoice is no longer overdue or its contact changed." }, { merge: true });
        counts.skipped++;
        continue;
      }
    }

    const claimed = await adminDb.runTransaction(async tx => {
      const snapshot = await tx.get(doc.ref);
      if (snapshot.get("status") !== pendingStatus || (snapshot.get("scheduledAt") as number) > Date.now()) return false;
      if (purpose === "owner_notification") {
        const settingsRef = adminDb.collection(OWNER_CALL_SETTINGS).doc(businessId);
        const [settings,business] = await Promise.all([tx.get(settingsRef),tx.get(adminDb.collection("businesses").doc(businessId))]);
        if (!settings.get("enabled") || settings.get("version") !== data.settingsVersion || business.get("ownerUid") !== data.ownerUid || data.source === "new_inspection" && !settings.get("newInspections")) {
          tx.update(doc.ref,{status:"CANCELLED",reason:"Owner permission changed before dialing.",updatedAt:Date.now()});
          return "owner-cancelled";
        }
        const last = settings.get("lastCallStartedAt");
        const retryAt = typeof last === "number" ? last + 5 * 60_000 : 0;
        if (retryAt > Date.now()) {
          tx.update(doc.ref,{scheduledAt:retryAt,reason:"Waiting before another owner notification call.",updatedAt:Date.now()});
          return "owner-deferred";
        }
        tx.update(settingsRef,{lastCallStartedAt:Date.now()});
      }
      tx.update(doc.ref, { status: "CALLING", attemptedAt: Date.now(), updatedAt: Date.now() });
      if (purpose === "overdue_invoice") tx.set(adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id),
        { status: "REQUESTED", attemptedAt: Date.now() }, { merge: true });
      return true;
    });
    if (claimed === "owner-deferred") { counts.deferred++; continue; }
    if (claimed === "owner-cancelled") { counts.skipped++; continue; }
    if (!claimed) continue;

    if (purpose === "missed_call" && typeof data.missedAt === "number") {
      await saveCallbackAttempt(businessId, numberKey, { id: doc.id, did, missedAt: data.missedAt,
        attemptedAt: Date.now(), scheduledAt: data.scheduledAt, source: "scheduled", status: "REQUESTED" });
    }

    let status: "ANSWERED" | "NO_ANSWER" | "FAILED" | "UNKNOWN" = "UNKNOWN";
    let reason: string | undefined;
    try {
      const response = await requestSophieCallback({ id: doc.id, did, businessId, number,
        ...((purpose === "overdue_invoice"||purpose==="owner_requested"||purpose==="owner_notification") && typeof customerName === "string" ? { customerName } : {}),
        ...(purpose === "owner_notification" ? { ownerNotification: { requestCode: data.requestCode } } : {}),
        ...(purpose==="owner_requested"?{ownerRequest:{category:data.category,instructions:data.instructions,...(data.recipientNameKnown===false?{recipientNameKnown:false}:{})}}:{}) });
      if (response.status === 429) {
        const retryAt = Date.now() + busyRetryMs;
        await doc.ref.update({ status: pendingStatus, scheduledAt: retryAt, updatedAt: Date.now(), reason: "Bridge is busy; retrying shortly." });
        if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
          .set({ status: "SCHEDULED", scheduledAt: retryAt }, { merge: true });
        counts.deferred++;
        continue;
      }
      if (!response.ok) {
        status = response.status < 500 ? "FAILED" : "UNKNOWN";
        reason = `Bridge returned HTTP ${response.status}.`;
      } else {
        const result = await response.json().catch(() => null);
        const mapped = callbackResultStatus(result?.status);
        status = mapped === "ANSWERED" || mapped === "NO_ANSWER" || mapped === "FAILED" ? mapped : "UNKNOWN";
        if (status === "FAILED" && typeof result?.code === "string") reason = result.code;
        else if (status === "UNKNOWN") reason = typeof result?.code === "string" ? result.code : "Bridge returned an unknown call result.";
      }
    } catch {
      status = "UNKNOWN";
      reason = "Call result could not be confirmed.";
    }

    await doc.ref.update({ status, ...(reason && { reason }), completedAt: Date.now(), updatedAt: Date.now() });
    if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
      .set({ status, ...(reason && { reason }), attemptedAt: data.scheduledAt, completedAt: Date.now() }, { merge: true });
    if (purpose === "missed_call") {
      await saveCallbackAttempt(businessId, numberKey, { id: doc.id, did, missedAt: data.missedAt,
        attemptedAt: data.scheduledAt, scheduledAt: data.scheduledAt, source: "scheduled", status });
      if (status === "ANSWERED" && typeof data.missedAt === "number") {
        await resolveCallback(businessId, numberKey, data.missedAt, "sophie_callback_answered");
      }
    }
    counts.processed++;
    if (status === "FAILED" || status === "UNKNOWN") counts.errors++;
  }
  return counts;
}
