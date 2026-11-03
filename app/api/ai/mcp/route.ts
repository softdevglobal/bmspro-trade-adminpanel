import { authenticateVoiceBridge } from "@/lib/ai/config";
import { createTradeVoiceReads, handleTradeVoiceMcp } from "@/lib/ai/mcp/mcp-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateVoiceBridge(request);
  if (!auth.ok) return Response.json({ error: "Trade voice connection unavailable or unauthorized." }, {
    status: auth.status, headers: { "Cache-Control": "no-store" },
  });
  try {
    const { consumeRateLimits } = await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{ key: `trade-voice:${auth.binding.did}`, limit: 120, windowMs: 60_000 }])) {
      return Response.json({ error: "Trade voice request limit reached." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    const reads = await createTradeVoiceReads(auth.binding);
    return await handleTradeVoiceMcp(request, reads);
  } catch {
    return Response.json({ error: "Trade voice business is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

// Stateless MCP does not open a persistent SSE channel.
export function GET() {
  return Response.json({ error: "Use MCP POST requests." }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
