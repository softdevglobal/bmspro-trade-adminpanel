import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";
import { requireOwnerBriefing } from "@/lib/ai/owner-call/auth";
import {
  ownerKnowledgeEnabled, ownerVoiceToolList, type OwnerToolArgs, type OwnerToolContext,
} from "@/lib/ai/owner-call/tools";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after } from "next/server";

export const runtime = "nodejs";

/**
 * The knowledge search for the owner's own business. businessId comes from the
 * login, never from tool arguments. requireOwnerBriefing has already checked the
 * owner and that the business is active in this request, so `business` does not
 * read it again. Owner questions are logged but not sent to the Unanswered page.
 */
async function ownerKnowledge(businessId: string): Promise<OwnerToolContext["knowledge"]> {
  const { createVoiceKnowledgeTools } = await import("@/lib/ai/mcp/tools/knowledge.tools");
  return createVoiceKnowledgeTools(
    { businessId },
    async () => ({ businessId }),
    (stage, task) => after(async () => {
      try { await task(); } catch { console.error("[owner-voice] Post-response task failed", { stage }); }
    }),
    { recordUnanswered: false, source: "owner_voice" },
  );
}

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
  for (const tool of ownerVoiceToolList({ knowledge: ownerKnowledgeEnabled() })) {
    server.tool(tool.name, tool.description, tool.args, async (args) => {
      try {
        // Briefing-only requests never load the RAG code.
        const knowledge = tool.usesKnowledge ? await ownerKnowledge(auth.businessId) : undefined;
        return output((await tool.run({ briefing, knowledge }, args as OwnerToolArgs)) as object);
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
