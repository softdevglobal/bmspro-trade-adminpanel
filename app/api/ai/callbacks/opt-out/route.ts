import { z } from "zod";
import { authenticateVoiceBridge } from "@/lib/ai/config";
import { adminDb } from "@/lib/firebase/admin";
import { lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { INVOICE_CALL_ATTEMPTS_COLLECTION } from "@/lib/ai/calls/invoice-call-history";
import { callbackState, readCallbackAttempts, resolveCallback } from "@/lib/ai/calls/callback-state";
import { normalizeInvoiceCallbackNumber } from "@/lib/ai/calls/callback-number";
import { normalizeCallbackMobile } from "@/lib/ai/calls/callback-number";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { setCustomerCallOptOut } from "@/lib/ai/calls/call-preferences";
import { INVOICE_COLLECTION } from "@/lib/invoices/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({
  callbackAttemptId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  number: z.string().trim().min(6).max(24).refine(value => !!normalizeCallbackMobile(value)),
  callDirection: z.enum(["inbound", "outbound"]),
  customerConfirmed: z.literal(true),
}).strict().refine(value => value.callDirection === "inbound" || !!value.callbackAttemptId);
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Persists a caller's explicit request to stop Sophie outbound calls for this business. */
export async function POST(request: Request) {
  const auth = await authenticateVoiceBridge(request);
  if (!auth.ok) return json({ status: "UNAVAILABLE" }, auth.status);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ status: "REJECTED", code: "INVALID_OPT_OUT" }, 400);
  const { callbackAttemptId, callDirection } = parsed.data;
  const number = normalizeCallbackMobile(parsed.data.number)!;
  try {
    const route = await lookupVoiceDidRoute(auth.binding.did);
    if (route.state !== "active" || route.binding.businessId !== auth.binding.businessId) {
      return json({ status: "UNAVAILABLE" }, 403);
    }
    const phoneKey = phoneComparisonKey(number);
    if (!phoneKey) return json({ status: "REJECTED", code: "INVALID_NUMBER" }, 400);

    let missedAt: number | undefined;
    if (callDirection === "outbound" && callbackAttemptId) {
      const [invoiceAttempt,scheduledAttempt] = await Promise.all([adminDb.collection(INVOICE_CALL_ATTEMPTS_COLLECTION).doc(callbackAttemptId).get(),adminDb.collection("ai_scheduled_callbacks").doc(callbackAttemptId).get()]);
      if(scheduledAttempt.exists&&scheduledAttempt.get("purpose")==="owner_requested"){
        const data=scheduledAttempt.data()!;
        if(data.businessId!==auth.binding.businessId||data.did!==auth.binding.did||data.numberKey!==phoneKey||!["CALLING","ANSWERED","UNKNOWN"].includes(data.status))return json({status:"REJECTED",code:"ATTEMPT_MISMATCH"},403);
      }else if (invoiceAttempt.exists) {
        const data = invoiceAttempt.data()!;
        if (data.businessId !== auth.binding.businessId || data.did !== auth.binding.did ||
            !["REQUESTED", "ANSWERED", "UNKNOWN", "SCHEDULED", "CALLING"].includes(data.status)) {
          return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
        }
        if (typeof data.invoiceId !== "string") return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
        const invoice = await adminDb.collection(INVOICE_COLLECTION).doc(data.invoiceId).get();
        const invoiceData = invoice.data();
        const storedNumber = invoiceData?.businessId === auth.binding.businessId
          ? normalizeInvoiceCallbackNumber(invoiceData.customer?.phone) : null;
        if (!storedNumber || phoneComparisonKey(storedNumber) !== phoneKey) {
          return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
        }
      } else {
        const stateRef = callbackState(auth.binding.businessId, phoneKey);
        const state = (await stateRef.get()).data();
        const attempt = readCallbackAttempts(state?.history).find(row => row.id === callbackAttemptId);
        if (!attempt || attempt.did !== auth.binding.did || !["REQUESTED", "ANSWERED", "UNKNOWN", "DEFERRED", "SCHEDULED"].includes(attempt.status)) {
          return json({ status: "REJECTED", code: "ATTEMPT_MISMATCH" }, 403);
        }
        missedAt = attempt.missedAt;
      }
    }

    await setCustomerCallOptOut({ businessId: auth.binding.businessId, phone: number, doNotCall: true, source: "customer_request" });
    if (missedAt !== undefined) await resolveCallback(auth.binding.businessId, phoneKey, missedAt, "customer_opt_out");
    return json({ status: "RECORDED" });
  } catch {
    return json({ status: "UNAVAILABLE", code: "OPT_OUT_SAVE_FAILED" }, 503);
  }
}
