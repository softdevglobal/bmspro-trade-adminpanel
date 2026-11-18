import { requestSophieCallback } from "@/lib/ai/calls/request-callback";
import { callbackResultStatus, callbackState, resolveCallback, saveCallbackAttempt, type CallbackAttempt } from "@/lib/ai/calls/callback-state";
import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { CALL_LOGS_COLLECTION } from "@/lib/ai/data/call-logs";
import { normalizeCallbackMobile } from "@/lib/ai/calls/callback-number";
import { recordingConfig, verifyCallbackGrant } from "@/lib/ai/calls/recordings";
import { lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { isCustomerCallOptedOut } from "@/lib/ai/calls/call-preferences";

export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers });
  const attemptId = new URL(request.url).searchParams.get("attemptId") ?? "";
  if (!/^[a-f0-9]{64}$/.test(attemptId)) {
    return Response.json({ error: "Invalid callback reference." }, { status: 400, headers });
  }
  const matches = await adminDb.collection(CALL_LOGS_COLLECTION).where("businessId", "==", auth.businessId)
    .where("callbackAttemptId", "==", attemptId).select("endedAt", "turnCount").limit(1).get();
  const call = matches.docs[0];
  return Response.json(call?.get("endedAt")
    ? { callId: call.id, hasTranscript: call.get("turnCount") > 0 }
    : { callId: null }, { headers });
}

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
    if (await isCustomerCallOptedOut(auth.businessId, number)) {
      return json({ error: "This customer has opted out of Sophie calls." }, 409);
    }
    if (!await consumeRateLimits([{ key: `sophie-callback:${auth.businessId}`, limit: 5, windowMs: 60_000 }])) {
      return json({ error: "Too many callback requests. Try again in a minute." }, 429);
    }
    const id = createHash("sha256").update(JSON.stringify([auth.businessId, claim.did, number, claim.startedAt])).digest("hex");
    const ref = callbackState(auth.businessId, claim.callerKey);
    const manualLeaseId = randomUUID();
    const conflict = await adminDb.runTransaction(async tx => {
      const state = await tx.get(ref);
      if (claim.startedAt <= (state.get("through") ?? -1)) return "This missed call is already resolved.";
      const activeUntil = Math.max(state.get("leaseUntil") ?? 0, state.get("manualLeaseUntil") ?? 0);
      if (activeUntil > Date.now()) return "A callback is already in progress. Check Calls shortly.";
      tx.set(ref, { manualLeaseId, manualLeaseUntil: Date.now() + 60_000 }, { merge: true });
      return null;
    });
    if (conflict) return json({ error: conflict }, 409);
    const entry: CallbackAttempt = { id, did: claim.did, missedAt: claim.startedAt, attemptedAt: Date.now(),
      source: "manual", status: "REQUESTED" };
    let attemptStatus: CallbackAttempt["status"] = "UNKNOWN";
    try {
      await saveCallbackAttempt(auth.businessId, claim.callerKey, entry);
      const response = await requestSophieCallback({ id, did: claim.did, businessId: auth.businessId, number });
      if (!response.ok && response.status < 500) attemptStatus = response.status === 429 ? "DEFERRED" : "FAILED";
      if (response.status === 403) return json({ error: "This business number or mobile is outside the callback pilot." }, 403);
      if (response.status === 404) return json({ error: "The voice bridge callback pilot is disabled or its settings are invalid." }, 503);
      if (response.status === 429) return json({ error: "The voice bridge is busy. Try again shortly." }, 429);
      if (!response.ok) return json({ error: "Sophie could not start the callback." }, 502);
      const { status, code, reason } = await response.json();
      if (!["ANSWERED", "NO_ANSWER", "FAILED", "UNKNOWN"].includes(status)) {
        return json({ error: "The callback result could not be verified." }, 502);
      }
      attemptStatus = callbackResultStatus(status);
      if (status === "ANSWERED") await resolveCallback(auth.businessId, claim.callerKey, claim.startedAt, "sophie_callback_answered");
      return json({
        status,
        attemptId: id,
        code: typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : undefined,
        reason: typeof reason === "string" && /^\d{1,3}$/.test(reason) ? reason : undefined,
      });
    } finally {
      try {
        await saveCallbackAttempt(auth.businessId, claim.callerKey, { ...entry, status: attemptStatus });
      } finally {
        await adminDb.runTransaction(async tx => {
          if ((await tx.get(ref)).get("manualLeaseId") === manualLeaseId) tx.update(ref, { manualLeaseUntil: 0 });
        });
      }
    }
  } catch {
    return json({ error: "The callback result could not be verified. Check the call history before trying again." }, 503);
  }
}
