import { authenticateVoiceBridgeCredential } from "@/lib/ai/config";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Authenticated route discovery, separate from the two business MCP tools. */
export async function POST(request: Request) {
  const auth = authenticateVoiceBridgeCredential(request);
  if (!auth.ok) return json({ error: "Trade voice discovery is unavailable or unauthorized." }, auth.status);
  try {
    const [{ consumeRateLimits }, { lookupVoiceDidRoute }] = await Promise.all([
      import("@/lib/security/rate-limit"), import("@/lib/ai/data/did-mappings"),
    ]);
    if (!await consumeRateLimits([{ key: "trade-voice-discovery", limit: 240, windowMs: 60_000 }])) {
      return json({ error: "Trade voice discovery limit reached." }, 429);
    }
    const route = await lookupVoiceDidRoute(auth.did);
    if (route.state === "disabled") return json({ error: "This Trade number or business is disabled." }, 403);
    if (route.state === "unmapped") return json({ matched: false, did: auth.did });
    return json({ matched: true, brand: "trade", ...route.binding });
  } catch { return json({ error: "Trade voice routing is unavailable." }, 503); }
}

export function GET() { return json({ error: "Use authenticated POST requests." }, 405); }
