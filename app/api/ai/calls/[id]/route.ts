/**
 * One AI call log for the signed-in business owner.
 *
 * GET    — full details including the conversation text.
 * DELETE — permanently remove the log (e.g. on a customer's privacy request).
 */
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";

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
  const { adminDb } = await import("@/lib/firebase/admin");
  const ref = adminDb.collection(CALL_LOGS_COLLECTION).doc(id);
  const data = (await ref.get()).data();
  if (!data || data.businessId !== auth.businessId) return { response: notFound() };
  return { id, ref, data };
}

export async function GET(request: Request, context: Context) {
  try {
    const call = await ownedCall(request, context);
    if ("response" in call) return call.response;
    return json({ ok: true, call: toCallLogDetail(call.id, call.data) });
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
