import { requestSophieCallback } from "@/lib/ai/calls/request-callback";
import { resolveCallback } from "@/lib/ai/calls/callback-state";
import { createHash } from "node:crypto";
import { normalizeCallbackMobile } from "@/lib/ai/calls/callback-number";
import { recordingConfig, verifyCallbackGrant } from "@/lib/ai/calls/recordings";
import { lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { consumeRateLimits } from "@/lib/security/rate-limit";

export const maxDuration = 60;

export async function POST(request: Request) {
  const json = (body: object, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const config = recordingConfig();
  const secret = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true" || !config || secret.length < 32) {
    return json({ error: "Sophie callbacks are unavailable." }, 503);
  }
  const claim = verifyCallbackGrant(config, auth.businessId, request.headers.get("x-callback-grant") ?? "");
  if (!claim) return json({ error: "Refresh Calls and select the missed call again." }, 404);
  const number = normalizeCallbackMobile(claim.number);
  if (!number || number === claim.did) {
    return json({ error: "Callbacks support Australian landlines and mobiles, and Sri Lankan mobiles." }, 422);
  }
  try {
    const mapping = await lookupVoiceDidRoute(claim.did);
    if (mapping.state !== "active" || mapping.binding.businessId !== auth.businessId) {
      return json({ error: "This business number is unavailable for callbacks." }, 403);
    }
    if (!await consumeRateLimits([{ key: `sophie-callback:${auth.businessId}`, limit: 5, windowMs: 60_000 }])) {
      return json({ error: "Too many callback requests. Try again in a minute." }, 429);
    }
    const id = createHash("sha256").update(JSON.stringify([auth.businessId, claim.did, number, claim.startedAt])).digest("hex");
    const response = await requestSophieCallback({ id, did: claim.did, businessId: auth.businessId, number });
    if (response.status === 403) return json({ error: "This business number or mobile is outside the callback pilot." }, 403);
    if (response.status === 404) return json({ error: "The voice bridge callback pilot is disabled or its settings are invalid." }, 503);
    if (response.status === 429) return json({ error: "The voice bridge is busy. Try again shortly." }, 429);
    if (!response.ok) return json({ error: "Sophie could not start the callback." }, 502);
    const { status, code, reason } = await response.json();
    if (!["ANSWERED", "NO_ANSWER", "FAILED", "UNKNOWN"].includes(status)) {
      return json({ error: "The callback result could not be verified." }, 502);
    }
    if (status === "ANSWERED") await resolveCallback(auth.businessId, claim.callerKey, claim.startedAt);
    return json({
      status,
      code: typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : undefined,
      reason: typeof reason === "string" && /^\d{1,3}$/.test(reason) ? reason : undefined,
    });
  } catch {
    return json({ error: "The callback result could not be verified. Check the call history before trying again." }, 503);
  }
}
