import { authenticateVoiceBridge, authenticateVoiceBridgeCredential } from "@/lib/ai/config";
import { createTradeVoiceReads, handleTradeVoiceMcp } from "@/lib/ai/mcp/mcp-server";
import { after } from "next/server";

export const runtime = "nodejs";

const unauthorized = (status: number) => Response.json({ error: "Trade voice connection unavailable or unauthorized." }, {
  status, headers: { "Cache-Control": "no-store" },
});

/**
 * Per-DID request limit for the bridge-only MCP route, counted in memory.
 * The Firestore transaction used elsewhere cost 1–2.6 s on every MCP request,
 * and one call makes several requests. This route is reachable only with the
 * bridge's shared secret, so the limit guards against a runaway bridge rather
 * than public abuse; per-instance counting is enough for that. Call-start
 * discovery (/api/ai/voice) keeps its durable Firestore limit.
 */
const RATE_LIMIT = 120, RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, { count: number; until: number }>();
function allowVoiceRequest(did: string, now = Date.now()) {
  const current = rateWindows.get(did);
  if (!current || current.until <= now) {
    if (rateWindows.size > 1000) rateWindows.clear();
    rateWindows.set(did, { count: 1, until: now + RATE_WINDOW_MS });
    return true;
  }
  current.count++;
  return current.count <= RATE_LIMIT;
}

export async function POST(request: Request) {
  const started = performance.now();
  // The bearer secret and DID format are checked first, so only authenticated
  // bridge requests are counted.
  const credential = authenticateVoiceBridgeCredential(request);
  if (!credential.ok) return unauthorized(credential.status);
  const auth = await authenticateVoiceBridge(request);
  const authMs = Math.round(performance.now() - started);
  if (!auth.ok) return unauthorized(auth.status);
  try {
    if (!allowVoiceRequest(auth.binding.did)) {
      return Response.json({ error: "Trade voice request limit reached." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    const reads = await createTradeVoiceReads(auth.binding, (stage, task) => after(async () => {
      try { await task(); } catch { console.error("[trade-voice] Post-save task failed", { stage }); }
    }));
    const response = await handleTradeVoiceMcp(request, reads);
    response.headers.set("Server-Timing", `trade;dur=${Math.round(performance.now() - started)}, auth;dur=${authMs}`);
    return response;
  } catch {
    return Response.json({ error: "Trade voice business is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

// Stateless MCP does not open a persistent SSE channel.
export function GET() {
  return Response.json({ error: "Use MCP POST requests." }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
