import { authenticateVoiceBridgeCredential } from "@/lib/ai/config";

export const runtime = "nodejs";
const json = (value: unknown, status = 200, timing?: string) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", ...(timing && { "Server-Timing": timing }) },
});

/** Authenticated route discovery, separate from the two business MCP tools. */
export async function POST(request: Request) {
  const started = performance.now();
  const auth = authenticateVoiceBridgeCredential(request);
  if (!auth.ok) return json({ error: "Trade voice discovery is unavailable or unauthorized." }, auth.status);
  try {
    const [{ consumeRateLimits }, { lookupVoiceDidRoute }] = await Promise.all([
      import("@/lib/security/rate-limit"), import("@/lib/ai/data/did-mappings"),
    ]);
    if (!await consumeRateLimits([{ key: "trade-voice-discovery", limit: 240, windowMs: 60_000 }])) {
      return json({ error: "Trade voice discovery limit reached." }, 429);
    }
    const lookupStarted = performance.now();
    const route = await lookupVoiceDidRoute(auth.did);
    const timing = `trade;dur=${Math.round(performance.now() - started)}, did;dur=${Math.round(performance.now() - lookupStarted)}`;
    if (route.state === "disabled") return json({ error: "This Trade number or business is disabled." }, 403);
    if (route.state === "unmapped") return json({ matched: false, did: auth.did });
    const { businessName, timezone } = route.business;
    const profile = typeof businessName === "string" && businessName.trim()
      ? { businessName, timezone: timezone || "Australia/Melbourne" }
      : undefined;
    return json({ matched: true, brand: "trade", ...route.binding, profile,
      forwardingExtension: route.forwardingExtension }, 200, timing);
  } catch { return json({ error: "Trade voice routing is unavailable." }, 503); }
}

export function GET() { return json({ error: "Use authenticated POST requests." }, 405); }
