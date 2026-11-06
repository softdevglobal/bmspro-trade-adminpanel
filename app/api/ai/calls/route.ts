/**
 * AI call logs.
 *
 * POST — the voice bridge saves one finished call. Authenticated exactly like
 *        the MCP endpoint (bridge secret + DID + pinned business header).
 * GET  — the signed-in business owner lists recent calls (no transcript text).
 */
import { authenticateVoiceBridge } from "@/lib/ai/config";
import { CALL_LOGS_COLLECTION, callLogInput, toCallLogSummary } from "@/lib/ai/data/call-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY_BYTES = 400_000;
const SUMMARY_FIELDS = ["startedAt", "durationMs", "answered", "endReason", "callerNumber", "outcome",
  "firstCallerLine", "toolCount", "turnCount", "knowledgeSearches"];

export async function POST(request: Request) {
  if (process.env.AI_VOICE_CALL_LOGS_ENABLED === "false") return json({ ok: false, error: "Call logs are disabled." }, 404);
  const auth = await authenticateVoiceBridge(request);
  if (!auth.ok) return json({ ok: false, error: "Trade voice connection unavailable or unauthorized." }, auth.status);
  // A log must name the business it belongs to; authenticateVoiceBridge has already checked it matches the DID.
  if (!request.headers.get("x-bmspro-trade-business")) return json({ ok: false, error: "Missing business binding." }, 403);

  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return json({ ok: false, error: "Invalid call log." }, 400);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ ok: false, error: "Invalid call log." }, 400); }
  const parsed = callLogInput.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Invalid call log." }, 400);

  try {
    const { saveCallLog } = await import("@/lib/ai/calls/call-log");
    const created = await saveCallLog(auth.binding, parsed.data);
    return json({ ok: true, created }, created ? 201 : 200);
  } catch {
    console.error("[ai-calls] Call log could not be saved");
    return json({ ok: false, error: "Call log could not be saved." }, 503);
  }
}

export async function GET(request: Request) {
  const { requireBusinessOwner } = await import("@/lib/onboarding/services/server");
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const { adminDb } = await import("@/lib/firebase/admin");
    const snapshot = await adminDb.collection(CALL_LOGS_COLLECTION)
      .where("businessId", "==", auth.businessId).orderBy("startedAt", "desc").select(...SUMMARY_FIELDS).limit(100).get();
    return json({ ok: true, calls: snapshot.docs.map(doc => toCallLogSummary(doc.id, doc.data())) });
  } catch {
    return json({ ok: false, error: "Could not load AI calls." }, 503);
  }
}
