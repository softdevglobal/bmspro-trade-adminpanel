/**
 * One AI call log for the signed-in business owner.
 *
 * GET    — full details including the conversation text.
 * DELETE — permanently remove the log (e.g. on a customer's privacy request).
 */
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";
import { adminDb } from "@/lib/firebase/admin";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const notFound = () => json({ ok: false, error: "Call not found." }, 404);

async function ownedCall(request: Request, context: Context) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return { response: json({ ok: false, error: auth.error }, auth.status) };
  const { id } = await context.params;
  if (!validId(id)) return { response: notFound() };
  const ref = adminDb.collection(CALL_LOGS_COLLECTION).doc(id);
  const data = (await ref.get()).data();
  if (!data || data.businessId !== auth.businessId) return { response: notFound() };
  return { id, ref, data, businessId: auth.businessId };
}

export async function GET(request: Request, context: Context) {
  try {
    const call = await ownedCall(request, context);
    if ("response" in call) return call.response;
    const detail = toCallLogDetail(call.id, call.data);
    const links = await Promise.allSettled(detail.outcomes.map(async ({ tool, status, reference }) => {
      if (typeof reference !== "string" || !/^[\w-]{1,128}$/.test(reference)) return null;
      if ((tool === "create_inspection_request" && ["CONFIRMED", "PENDING_REVIEW"].includes(status)) ||
          (tool === "create_job_booking" && status === "PENDING_REVIEW")) {
        const record = await adminDb.collection(REQUESTS_COLLECTION).doc(reference).get();
        if (record.get("businessId") !== call.businessId) return null;
        if (tool === "create_inspection_request") {
          return { href: `/dashboard/requests?request=${reference}`, label: "Open inspection request" };
        }
        const bookingId: unknown = record.get("bookingId");
        if (typeof bookingId === "string" && /^[\w-]{1,128}$/.test(bookingId)) {
          const job = await adminDb.collection(JOBS_COLLECTION).doc(bookingId).get();
          return job.get("businessId") === call.businessId ? { href: `/dashboard/jobs?job=${bookingId}`, label: "Open job" } : null;
        }
        return { href: `/dashboard/jobs?callRequest=${reference}`, label: "Open job request" };
      }
      if ((["create_job_booking", "reschedule_job"].includes(tool) && status === "CONFIRMED") ||
          (tool === "cancel_job" && status === "CANCELLED")) {
        const jobs = await adminDb.collection(JOBS_COLLECTION).where("businessId", "==", call.businessId)
          .where("bookingCode", "==", reference).limit(2).get();
        if (jobs.size === 1) return { href: `/dashboard/jobs?job=${encodeURIComponent(jobs.docs[0].id)}`, label: "Open job" };
      }
      return null;
    }));
    return json({ ok: true, call: { ...detail, links: links.flatMap(link => link.status === "fulfilled" && link.value ? [link.value] : []) } });
  } catch {
    return json({ ok: false, error: "Could not load the call." }, 503);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const call = await ownedCall(request, context);
    if ("response" in call) return call.response;
    await call.ref.delete();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Could not delete the call." }, 503);
  }
}
