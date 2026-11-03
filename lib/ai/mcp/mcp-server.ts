import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { VoiceBusiness } from "../config";
import { findCustomerArguments, registerCustomerArguments, availabilityArguments, inspectionArguments,
  type VoiceActionResult, type ScheduleVoiceTask } from "./tools/action-schemas";

export interface TradeVoiceReads {
  profile(): Promise<unknown>;
  services(): Promise<unknown>;
  findCustomer?(input: unknown): Promise<VoiceActionResult>;
  registerCustomer?(input: unknown): Promise<VoiceActionResult>;
  availability?(input: unknown): Promise<unknown>;
  createInspection?(input: unknown): Promise<VoiceActionResult>;
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
  const find = reads.findCustomer, availability = reads.availability;
  if (find) server.tool("find_customer", "Match an exact caller-provided email and phone in this business only. Returns a reference, not stored profile data. Matching contacts does not verify identity or permit reading history.", findCustomerArguments.shape, args => tool(() => find(args)));
  if (availability) server.tool("get_available_slots", "Read live unavailable morning/afternoon sessions over a 1-90 day range. Other sessions are preferences, not confirmed bookings.", availabilityArguments.shape, args => tool(() => availability(args)));
  const write = async (run: () => Promise<VoiceActionResult>) => {
    let result: VoiceActionResult;
    try { result = await run(); } catch { result = { status: "UNKNOWN", message: "Staff must verify whether the action was saved. Do not resubmit with a new key or claim success." }; }
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  };
  const register = reads.registerCustomer, create = reads.createInspection;
  if (register) server.tool("register_customer", "Create a business-scoped customer account only after reading back name/email/phone and receiving explicit account-creation consent. Existing profiles are never edited. Reuse requestKey on retries. UNKNOWN requires staff verification; never retry with another key. Do not claim an activation email was delivered when it is pending.", registerCustomerArguments.shape, args => write(() => register(args)));
  if (create) server.tool("create_inspection_request", "Submit one inspection after listing services and successfully checking availability. Read back customer contacts, service, full site address and exact preferred sessions and obtain explicit confirmation. Customer account creation is optional; use customerId only from this call's customer tools, or null for a guest. Reuse requestKey on retries. PENDING_REVIEW means received for staff review, CONFIRMED means booked, REJECTED means not accepted, UNKNOWN means staff must verify; never resubmit uncertain outcomes.", inspectionArguments.shape, args => write(() => create(args)));
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
export async function createTradeVoiceReads(binding: VoiceBusiness, schedule?: ScheduleVoiceTask): Promise<TradeVoiceReads> {
  const { createTradeServiceTools } = await import("./tools/service.tools");
  const services = await createTradeServiceTools(binding);
  const reads: TradeVoiceReads = {
    profile: services.profile,
    services: services.services,
  };
  // Read tools work without a request lifecycle. Writes require deferred post-save tasks.
  const [{ createVoiceCustomerTools }, { createVoiceBookingTools }] = await Promise.all([
    import("./tools/customer.tools"), import("./tools/booking.tools"),
  ]);
  const defer = schedule ?? (() => { throw new Error("Post-save task scheduler unavailable."); });
  const customers = await createVoiceCustomerTools(binding, services.business, defer);
  const bookings = await createVoiceBookingTools(binding, services.business, defer);
  reads.findCustomer = customers.find;
  reads.availability = bookings.availability;
  if (schedule && process.env.AI_VOICE_ACTIONS_ENABLED === "true") {
    reads.registerCustomer = customers.register;
    reads.createInspection = bookings.create;
  }
  return reads;
}
