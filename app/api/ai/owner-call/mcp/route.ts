import {ownerVisitsEnabled} from "@/lib/ai/owner-call/owner-visits";
import {ownerScheduledCallsEnabled} from "@/lib/ai/owner-call/owner-scheduled-calls";
import { ownerCustomersEnabled } from "@/lib/ai/owner-call/owner-customer";
import { ownerItemsEnabled } from "@/lib/ai/owner-call/owner-item";
import { ownerSmsEnabled } from "@/lib/ai/owner-call/owner-sms";
import { ownerEmailEnabled } from "@/lib/ai/owner-call/owner-email";
import { ownerBriefingTools } from "@/lib/ai/mcp/tools/owner-briefing.tools";
import { requireOwnerBriefing } from "@/lib/ai/owner-call/auth";
import { ownerServiceEnabled } from "@/lib/ai/owner-call/owner-service"; // feature flag
import { ownerTeamEnabled } from "@/lib/ai/owner-call/owner-team"; // feature flag
import {
  ownerKnowledgeEnabled, ownerVoiceDraftsEnabled, ownerVoiceToolList, type OwnerToolArgs, type OwnerToolContext,
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

/** Service tools for the owner's own business. businessId and uid come from the login, never from tool arguments. */
async function ownerServices(owner: { businessId: string; uid: string; email: string | null }) {
  const { ownerServiceTools } = await import("@/lib/ai/mcp/tools/owner-service.tools"); // loaded only when a service tool runs
  return ownerServiceTools(owner);
}

/**
 * MCP action tools (services, team, knowledge drafts). They call the same Trade route handlers
 * the pages use, with this request's own owner token, so every rule and audit entry is the same.
 */
async function ownerActions(owner: { businessId: string; uid: string; timezone: string | null; authorization: string }) {
  const { ownerActionTools } = await import("@/lib/ai/mcp/tools/owner-actions.tools"); // loaded only when an action tool runs
  return ownerActionTools(owner);
}

export async function POST(request: Request) {
  const auth = await requireOwnerBriefing(request);
  if (!auth.ok) return new Response(null, { status: auth.status });
  if (!await consumeRateLimits([{ key: `owner-voice:read:${auth.uid}`, limit: 30, windowMs: 60_000 }])) {
    return new Response(null, { status: 429 });
  }

  const server = new McpServer({ name: "bmspro-trade-owner-call", version: "1.0.0" });
  // 16 KB: a service update can carry 12 steps with descriptions.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 16_384 });
  const output = (value: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const briefing = ownerBriefingTools(auth.businessId, auth.timezone);
  // Serves the MCP action tools in both tool modes, so whichever set the session offered works.
  const toolList = ownerVoiceToolList({
    knowledge: ownerKnowledgeEnabled(), services: ownerServiceEnabled(), team: ownerTeamEnabled(), drafts: ownerVoiceDraftsEnabled(),
    customers: ownerCustomersEnabled(), items: ownerItemsEnabled(), sms: ownerSmsEnabled(), email: ownerEmailEnabled(), actions: true, visits: ownerVisitsEnabled(), scheduledCalls:ownerScheduledCallsEnabled(),
  });
  for (const tool of toolList) {
    server.tool(tool.name, tool.description, tool.args, async (args) => {
      try {
        // This read-only lookup does not need the mutation routes imported by ownerActions.
        if (tool.name === "find_call_customers") {
          const { findOwnerCallCustomers } = await import("@/lib/ai/mcp/tools/owner-scheduled-calls.tools");
          return output(await findOwnerCallCustomers({
            businessId: auth.businessId, uid: auth.uid, timezone: auth.timezone ?? null,
            authorization: request.headers.get("authorization") ?? "",
          }, args));
        }
        // Briefing-only requests never load the RAG, service or action code.
        const knowledge = tool.usesKnowledge ? await ownerKnowledge(auth.businessId) : undefined;
        const services = tool.usesServices
          ? await ownerServices({ businessId: auth.businessId, uid: auth.uid, email: auth.email ?? null }) // identity from the login
          : undefined;
        const actions = tool.usesActions
          ? await ownerActions({
            businessId: auth.businessId, uid: auth.uid, timezone: auth.timezone ?? null,
            authorization: request.headers.get("authorization") ?? "", // the owner's own token, re-checked by each Trade route
          })
          : undefined;
        return output((await tool.run({ briefing, knowledge, services, actions }, args as OwnerToolArgs)) as object);
      } catch (error) {
        // Never log customer arguments, credentials or upstream error messages.
        const code = (error as { code?: unknown } | null)?.code;
        console.error("[owner-voice] Tool failed", {
          tool: tool.name,
          code: typeof code === "number" || (typeof code === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(code)) ? code : "unknown",
        });
        return { isError: true, ...output({ status: "UNAVAILABLE" }) }; // never leak server errors to the model
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
