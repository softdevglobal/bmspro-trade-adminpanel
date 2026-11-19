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

export async function runScheduledSophieCallbacks({ busyRetryMs = 5 * 60_000 } = {}) {
  const counts = { processed: 0, deferred: 0, skipped: 0, errors: 0 };
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true") return counts;

  const now = Date.now();
  const due = await loadDueScheduledCallbacks(adminDb, now);
  for (const doc of due) {
    const data = doc.data();
    if (typeof data.scheduledAt !== "number" || data.scheduledAt > now) continue;
    const { businessId, did, number, numberKey, purpose, invoiceId, customerName } = data;
    if (typeof businessId !== "string" || typeof did !== "string" || typeof number !== "string" ||
        typeof numberKey !== "string" || !["missed_call", "overdue_invoice"].includes(purpose)) {
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

    if (await isCustomerCallOptedOut(businessId, number)) {
      await doc.ref.update({ status: "CANCELLED", reason: "Customer opted out of Sophie calls.", updatedAt: Date.now() });
      if (purpose === "overdue_invoice") await adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id)
        .set({ status: "CANCELLED", reason: "Customer opted out of Sophie calls." }, { merge: true });
      counts.skipped++;
      continue;
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
      if (snapshot.get("status") !== "SCHEDULED" || (snapshot.get("scheduledAt") as number) > Date.now()) return false;
      tx.update(doc.ref, { status: "CALLING", attemptedAt: Date.now(), updatedAt: Date.now() });
      if (purpose === "overdue_invoice") tx.set(adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(doc.id),
        { status: "REQUESTED", attemptedAt: Date.now() }, { merge: true });
      return true;
    });
    if (!claimed) continue;

    if (purpose === "missed_call" && typeof data.missedAt === "number") {
      await saveCallbackAttempt(businessId, numberKey, { id: doc.id, did, missedAt: data.missedAt,
        attemptedAt: Date.now(), scheduledAt: data.scheduledAt, source: "scheduled", status: "REQUESTED" });
    }

    let status: "ANSWERED" | "NO_ANSWER" | "FAILED" | "UNKNOWN" = "UNKNOWN";
    let reason: string | undefined;
    try {
      const response = await requestSophieCallback({ id: doc.id, did, businessId, number,
        ...(purpose === "overdue_invoice" && typeof customerName === "string" ? { customerName } : {}) });
      if (response.status === 429) {
        const retryAt = Date.now() + busyRetryMs;
        await doc.ref.update({ status: "SCHEDULED", scheduledAt: retryAt, updatedAt: Date.now(), reason: "Bridge is busy; retrying shortly." });
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
