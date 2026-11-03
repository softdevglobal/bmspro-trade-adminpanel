import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { VoiceBusiness } from "../config";

export interface TradeVoiceReads {
  profile(): Promise<unknown>;
  services(): Promise<unknown>;
}

export async function handleTradeVoiceMcp(request: Request, reads: TradeVoiceReads) {
  const server = new McpServer({ name: "bmspro-trade-direct-voice", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 16_384 });
  const tool = async (run: () => Promise<unknown>) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await run()) }] }; }
    catch {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({
        status: "UNAVAILABLE", message: "Trade lookup could not be verified. Do not invent business facts or availability. Offer staff help.",
      }) }] };
    }
  };
  server.tool("get_business_profile", "Read the assigned Trade business profile. Business identity is controlled by the server.", {}, () => tool(reads.profile));
  server.tool("list_services", "List active services for the assigned business. No prices or availability may be invented.", {}, () => tool(reads.services));
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // JSON mode fully materializes the response before closing the stateless transport.
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.status === 202 || response.status === 204 ? null : body, { status: response.status, headers });
  } finally {
    await server.close();
  }
}

/** Loaded only after bridge authentication. Data tools recheck the active business. */
export async function createTradeVoiceReads(binding: VoiceBusiness): Promise<TradeVoiceReads> {
  const { createTradeServiceTools } = await import("./tools/service.tools");
  const services = await createTradeServiceTools(binding);
  return {
    profile: services.profile,
    services: services.services,
  };
}
