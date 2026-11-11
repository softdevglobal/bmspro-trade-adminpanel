import { findLiveSophieCalls, liveCallId, liveListenConfig, startSophieListening, type LiveCallDiagnostic } from "@/lib/ai/calls/live-listen";
import { bridgeLiveListenConfig, listBridgeCalls, listenToBridgeCall } from "@/lib/ai/calls/bridge-live-listen";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { consumeRateLimits } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.sophieLiveListenEnabled) return json({ enabled: false, calls: [] });
    const config = liveListenConfig();
    const bridge = bridgeLiveListenConfig();
    if (!config && !bridge) return json({ enabled: false, calls: [] });
    if (!await consumeRateLimits([{ key: "trade-live-calls:" + auth.businessId, limit: 30, windowMs: 60_000 }])) {
      return json({ error: "Too many live call checks. Try again shortly." }, 429);
    }
    if (bridge) {
      const calls = await listBridgeCalls(bridge, auth.businessId);
      return json({ enabled: true, source: "bridge", calls });
    }
    if (!config) return json({ enabled: false, calls: [] });
    const diagnostic: LiveCallDiagnostic | undefined = process.env.NODE_ENV === "development" ? {} : undefined;
    const calls = await findLiveSophieCalls(config, auth.businessId, undefined, diagnostic);
    return json({ enabled: true, calls: calls.map(({ id, did, startedAt, callerNumber }) => ({ id, did, startedAt, callerNumber })), diagnostic });
  } catch {
    return json({ error: "Could not check Sophie’s live calls." }, 502);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.sophieLiveListenEnabled) return json({ error: "Enable Listen live in Business settings." }, 403);
    const config = liveListenConfig();
    const bridge = bridgeLiveListenConfig();
    if (!config && !bridge) return json({ error: "Live listening is not configured." }, 503);
    const requestedId = request.headers.get("x-live-call-id") ?? "";
    if (!await consumeRateLimits([{ key: "trade-live-listen:" + auth.businessId, limit: 10, windowMs: 60_000 }])) {
      return json({ error: "Too many listening requests. Try again in a minute." }, 429);
    }
    if (bridge) {
      try {
        return await listenToBridgeCall(bridge, auth.businessId, requestedId, request.signal)
          ?? json({ error: "This live call is no longer available." }, 404);
      } catch {
        return json({ error: "Could not start live audio from the voice bridge." }, 502);
      }
    }
    if (!config) return json({ error: "Live listening is not configured." }, 503);
    const callId = liveCallId.safeParse(requestedId);
    if (!callId.success) return json({ error: "Invalid live call." }, 400);
    const [call] = await findLiveSophieCalls(config, auth.businessId, callId.data);
    if (!call) return json({ error: "This live call is no longer available." }, 404);
    if (!await consumeRateLimits([{
      key: "trade-live-listen-call:" + auth.businessId + ":" + call.id, limit: 1, windowMs: 15_000,
    }])) return json({ error: "A listening request was just made for this call. Check your extension." }, 429);
    await startSophieListening(config, call);
    return json({ ok: true });
  } catch {
    return json({ error: "Yeastar could not confirm the listening request. Check your extension before retrying." }, 502);
  }
}
