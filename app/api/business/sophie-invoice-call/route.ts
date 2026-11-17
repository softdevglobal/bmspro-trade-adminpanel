import { createHash } from "node:crypto";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";
import { INVOICE_CALL_ATTEMPTS_COLLECTION as attempts } from "@/lib/ai/calls/invoice-call-history";
import { callbackResultStatus, callbackState } from "@/lib/ai/calls/callback-state";
import { normalizeInvoiceCallbackNumber } from "@/lib/ai/calls/callback-number";
import { requestSophieCallback } from "@/lib/ai/calls/request-callback";
import { DID_MAPPINGS_COLLECTION, lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";
import { getBusinessInvoiceByQuotationId } from "@/lib/invoices/server";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";

export const maxDuration = 60;
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const invoiceKey = z.string().regex(/^[\w-]{1,128}$/);

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const parsed = invoiceKey.safeParse(new URL(request.url).searchParams.get("invoiceId"));
  if (!parsed.success) return json({ error: "Invalid invoice." }, 400);
  try {
    const [invoice, profile, routes, history] = await Promise.all([
      getBusinessInvoiceByQuotationId(auth.businessId, parsed.data),
      getBusinessProfile(auth.businessId),
      adminDb.collection(DID_MAPPINGS_COLLECTION).where("businessId", "==", auth.businessId).where("isActive", "==", true).get(),
      adminDb.collection(attempts).where("businessId", "==", auth.businessId).where("invoiceId", "==", parsed.data).get(),
    ]);
    if (!invoice || !profile?.enabledModules.invoices) return json({ error: "Invoice unavailable." }, 404);
    const recent = history.docs.sort((a, b) => b.get("attemptedAt") - a.get("attemptedAt")).slice(0, 10);
    const logs = recent.length ? await adminDb.collection(CALL_LOGS_COLLECTION).where("businessId", "==", auth.businessId)
      .where("callbackAttemptId", "in", recent.map(doc => doc.id)).get() : null;
    const transcripts = new Map(logs?.docs.map(doc => [doc.get("callbackAttemptId"), toCallLogDetail(doc.id, doc.data())]));
    const callingRoutes = routes.docs.filter(doc => doc.get("callback.callerId")).map(doc => doc.id);
    const destination = normalizeInvoiceCallbackNumber(invoice.customer.phone);
    let unavailableReason: string | null = null;
    if (!resolveInvoicePaymentDue(invoice, profile.timezone).isOverdue) {
      unavailableReason = "This invoice must be issued, overdue, and have an outstanding balance.";
    } else if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true") {
      unavailableReason = "Enable AI_SOPHIE_CALLBACK_ENABLED in Trade and restart the app.";
    } else if (!invoice.customer.fullName.trim() || !destination) {
      unavailableReason = "Add a customer name and a supported phone number to this invoice. Use +94 for a Sri Lankan mobile.";
    } else if (!callingRoutes.length) {
      unavailableReason = "Enable Sophie callbacks on this business’s DID in Super Admin → DID mappings.";
    }
    return json({
      routes: callingRoutes,
      canCall: unavailableReason === null,
      unavailableReason,
      destination,
      history: recent.map(doc => {
        const call = transcripts.get(doc.id);
        return { id: doc.id, attemptedAt: doc.get("attemptedAt"), status: doc.get("status"), reason: doc.get("reason") ?? null, callId: call?.id ?? null,
          responses: call?.transcript.filter(turn => turn.speaker === "caller").map(turn => turn.text.slice(0, 500)).slice(-6) ?? [] };
      }),
    });
  } catch {
    return json({ error: "Could not load invoice calls." }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true") return json({ error: "Sophie calls are disabled." }, 503);
  const input = z.object({ invoiceId: invoiceKey, did: z.string().regex(/^\d{6,15}$/), requestId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Choose an invoice and a business number." }, 400);
  const { invoiceId, did, requestId } = input.data;
  const businessId = auth.businessId;
  try {
    if (!await consumeRateLimits([{ key: `sophie-invoice-call:${businessId}`, limit: 5, windowMs: 60_000 }])) {
      return json({ error: "Too many invoice call requests." }, 429);
    }
    const [invoice, profile, route] = await Promise.all([
      getBusinessInvoiceByQuotationId(businessId, invoiceId),
      getBusinessProfile(businessId),
      lookupVoiceDidRoute(did),
    ]);
    if (!invoice || !profile?.enabledModules.invoices) return json({ error: "Invoice unavailable." }, 404);
    if (!resolveInvoicePaymentDue(invoice, profile.timezone).isOverdue) return json({ error: "This invoice is no longer overdue." }, 409);
    if (route.state !== "active" || route.binding.businessId !== businessId || !route.callback) {
      return json({ error: "Choose a business number that has Sophie callbacks enabled." }, 403);
    }
    const number = normalizeInvoiceCallbackNumber(invoice.customer.phone);
    const customerName = invoice.customer.fullName.trim().slice(0, 120);
    const key = phoneComparisonKey(number);
    if (!number || !key || !customerName || number === did) {
      return json({ error: "The invoice needs a customer name and a supported phone number." }, 422);
    }
    const id = createHash("sha256").update(JSON.stringify([businessId, invoiceId, requestId])).digest("hex");
    const ref = adminDb.collection(attempts).doc(id);
    const lease = callbackState(businessId, key);
    const claimed = await adminDb.runTransaction(async tx => {
      const [previous, state] = await tx.getAll(ref, lease);
      if (previous.exists || Math.max(state.get("manualLeaseUntil") ?? 0, state.get("leaseUntil") ?? 0) > Date.now()) return false;
      tx.create(ref, { businessId, invoiceId, did, status: "REQUESTED", attemptedAt: Date.now() });
      tx.set(lease, { manualLeaseId: id, manualLeaseUntil: Date.now() + 60_000 }, { merge: true });
      return true;
    });
    if (!claimed) return json({ error: "A call was already requested for this customer." }, 409);
    let status: string = "UNKNOWN";
    try {
      const response = await requestSophieCallback({ id, did, businessId, number, customerName });
      status = response.ok ? callbackResultStatus((await response.json()).status) : response.status < 500 ? "FAILED" : "UNKNOWN";
      if (response.status === 404) return json({ error: "Update the voice bridge to enable invoice calls." }, 503);
      return json({ status, attemptId: id });
    } finally {
      await adminDb.runTransaction(async tx => {
        const state = await tx.get(lease);
        tx.update(ref, { status });
        if (state.get("manualLeaseId") === id && status !== "UNKNOWN") tx.update(lease, { manualLeaseUntil: 0 });
      });
    }
  } catch {
    return json({ error: "Could not verify the invoice call outcome. Check the invoice call history." }, 503);
  }
}
