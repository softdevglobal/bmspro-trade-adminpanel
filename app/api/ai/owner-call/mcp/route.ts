import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";
import { requireOwnerBriefing } from "@/lib/ai/owner-call/auth";
import { ownerVoiceTools } from "@/lib/ai/owner-call/tools";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireOwnerBriefing(request);
  if (!auth.ok) return new Response(null, { status: auth.status });
  if (!await consumeRateLimits([{ key: `owner-voice:read:${auth.uid}`, limit: 30, windowMs: 60_000 }])) {
    return new Response(null, { status: 429 });
  }

  const server = new McpServer({ name: "bmspro-trade-owner-call", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 8_192 });
  const output = (value: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const briefing = ownerBriefingTools(auth.businessId, auth.timezone);
  for (const tool of ownerVoiceTools) {
    server.tool(tool.name, tool.description, tool.args, async ({ offset = 0 }) => {
      try {
        return output(await tool.run(briefing, offset));
      } catch {
        return { isError: true, ...output({ status: "UNAVAILABLE" }) };
      }
    });
  }

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.status === 202 || response.status === 204 ? null : body, { status: response.status, headers });
  } finally {
    await server.close();
  }
}
