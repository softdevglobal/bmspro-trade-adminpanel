import { createHash } from "node:crypto";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateVoiceBridgeCredential } from "@/lib/ai/config";
import { lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { INVOICE_CALL_ATTEMPTS_COLLECTION } from "@/lib/ai/calls/invoice-call-history";
import { callbackState, readCallbackAttempts, saveCallbackAttempt } from "@/lib/ai/calls/callback-state";
import { normalizeInvoiceCallbackNumber } from "@/lib/ai/calls/callback-number";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { INVOICE_COLLECTION, mapInvoiceDoc } from "@/lib/invoices/server";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";
import { isCustomerCallOptedOut } from "@/lib/ai/calls/call-preferences";
import { isWithinSophieCallingHours } from "@/lib/ai/calls/calling-hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  callbackAttemptId: z.string().regex(/^[a-f0-9]{64}$/),
  number: z.string().regex(/^(?:0[23478]\d{8}|947\d{8})$/),
  scheduledAt: z.string().datetime({ offset: true }),
}).strict();

const SCHEDULED_CALLBACKS = "ai_scheduled_callbacks";
const json = (value: object, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" },
});

/**
 * The bridge may schedule a follow-up only for the callback currently in its
 * call context. Trade rebinds the authenticated DID to a tenant and verifies
 * that the attempt and customer number belong to that tenant before writing.
 */
export async function POST(request: Request) {
  const auth = authenticateVoiceBridgeCredential(request);
  if (!auth.ok) return json({ status: "UNAVAILABLE" }, auth.status);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ status: "REJECTED", code: "INVALID_SCHEDULE" }, 400);

  const { callbackAttemptId, number, scheduledAt } = parsed.data;
  const when = Date.parse(scheduledAt);
  const now = Date.now();
  if (!Number.isFinite(when) || when <= now || when > now + 30 * 24 * 60 * 60_000) {
    return json({ status: "REJECTED", code: "TIME_OUT_OF_RANGE" }, 400);
  }

  try {
    const [route, invoiceAttempt] = await Promise.all([
      lookupVoiceDidRoute(auth.did),
      adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(callbackAttemptId).get(),
    ]);
    const pinnedBusinessId = request.headers.get("x-bmspro-trade-business");
    if (route.state !== "active" || !route.callback?.callerId ||
        (pinnedBusinessId !== null && pinnedBusinessId !== route.binding.businessId)) {
      return json({ status: "UNAVAILABLE" }, 403);
    }
    const businessId = route.binding.businessId;
    const businessTimezone = typeof route.business.timezone === "string" && route.business.timezone
      ? route.business.timezone : "Australia/Melbourne";

    let purpose: "overdue_invoice" | "missed_call";
    let invoiceId: string | undefined;
    let customerName: string | undefined;
    let missedAt: number | undefined;
    const numberKey = phoneComparisonKey(number);
    if (!numberKey) return json({ status: "REJECTED", code: "INVALID_NUMBER" }, 400);
    if (await isCustomerCallOptedOut(businessId, number)) {
      return json({ status: "REJECTED", code: "CUSTOMER_OPTED_OUT" }, 409);
    }
    if (!isWithinSophieCallingHours(when, businessTimezone, route.business.sophieCallingHours ?? undefined)) {
      return json({ status: "REJECTED", code: "OUTSIDE_CALLING_HOURS" }, 400);
    }

    if (invoiceAttempt.exists) {
      if (process.env.AI_SOPHIE_INVOICE_CALLS_ENABLED !== "true" || route.business.sophieInvoiceCallsEnabled !== true) {
        return json({ status: "REJECTED", code: "INVOICE_CALLS_DISABLED" }, 403);
      }
      const attempt = invoiceAttempt.data()!;
      if (attempt.businessId !== businessId || attempt.did !== auth.did || typeof attempt.invoiceId !== "string" ||
          !["REQUESTED", "ANSWERED", "UNKNOWN"].includes(attempt.status)) {
        return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
      }
      const invoiceDoc = await adminDb.collection(INVOICE_COLLECTION).doc(attempt.invoiceId).get();
      const data = invoiceDoc.data();
      const invoice = data?.businessId === businessId ? mapInvoiceDoc(invoiceDoc.id, data) : null;
      const invoiceNumber = invoice ? normalizeInvoiceCallbackNumber(invoice.customer.phone) : null;
      if (!invoice || !invoiceNumber || phoneComparisonKey(invoiceNumber) !== numberKey ||
          !resolveInvoicePaymentDue(invoice, businessTimezone).isOverdue) {
        return json({ status: "REJECTED", code: "INVOICE_NOT_ELIGIBLE" }, 409);
      }
      purpose = "overdue_invoice";
      invoiceId = invoiceDoc.id;
      customerName = invoice.customer.fullName.trim().slice(0, 120);
    } else {
      const stateRef = callbackState(businessId, numberKey);
      const state = (await stateRef.get()).data();
      const attempt = readCallbackAttempts(state?.history).find(row => row.id === callbackAttemptId);
      if (!attempt || attempt.did !== auth.did || !["REQUESTED", "ANSWERED", "UNKNOWN", "DEFERRED"].includes(attempt.status)) {
        return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
      }
      purpose = "missed_call";
      missedAt = attempt.missedAt;
    }

    const scheduleId = createHash("sha256")
      .update(JSON.stringify(["customer-requested-callback", businessId, callbackAttemptId]))
      .digest("hex");
    const scheduledRef = adminDb.collection(SCHEDULED_CALLBACKS).doc(scheduleId);
    const attemptRef = adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(scheduleId);
    const outcome = await adminDb.runTransaction(async tx => {
      const existing = await tx.get(scheduledRef);
      if (existing.exists) return { created: false, status: existing.get("status") as string,
        scheduledAt: existing.get("scheduledAt") as number };
      const record = {
        businessId, did: auth.did, number, numberKey, purpose,
        sourceAttemptId: callbackAttemptId, scheduledAt: when, timezone: businessTimezone,
        status: "SCHEDULED", createdAt: now, updatedAt: now,
        ...(invoiceId && { invoiceId }), ...(customerName && { customerName }), ...(missedAt && { missedAt }),
      };
      tx.create(scheduledRef, record);
      if (purpose === "overdue_invoice") tx.create(attemptRef, {
        businessId, invoiceId, did: auth.did, status: "SCHEDULED",
        attemptedAt: now, scheduledAt: when, source: "customer_requested", parentAttemptId: callbackAttemptId,
      });
      return { created: true, status: "SCHEDULED", scheduledAt: when };
    });

    if (purpose === "missed_call" && outcome.created) {
      await saveCallbackAttempt(businessId, numberKey, {
        id: scheduleId, did: auth.did, missedAt: missedAt!, attemptedAt: now,
        scheduledAt: when, source: "scheduled", status: "SCHEDULED",
      });
    }
    if (!outcome.created && outcome.status !== "SCHEDULED") {
      return json({ status: "REJECTED", code: "SCHEDULE_ALREADY_PROCESSED" }, 409);
    }
    const localTime = new Intl.DateTimeFormat("en-AU", {
      timeZone: businessTimezone, dateStyle: "full", timeStyle: "short",
    }).format(new Date(outcome.scheduledAt));
    return json({ status: outcome.created ? "SCHEDULED" : "ALREADY_SCHEDULED",
      scheduledAt: new Date(outcome.scheduledAt).toISOString(), localTime });
  } catch {
    return json({ status: "UNAVAILABLE", code: "SCHEDULE_FAILED" }, 503);
  }
}
