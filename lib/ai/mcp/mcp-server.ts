import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { VoiceBusiness } from "../config";
import { findCustomerArguments, registerCustomerArguments, availabilityArguments, inspectionArguments,
  jobBookingArguments, jobLookupArguments, jobRescheduleArguments, jobCancelArguments,
  type VoiceActionResult, type ScheduleVoiceTask } from "./tools/action-schemas";

export interface TradeVoiceReads {
  profile(): Promise<unknown>;
  services(): Promise<unknown>;
  findCustomer?(input: unknown): Promise<VoiceActionResult>;
  registerCustomer?(input: unknown): Promise<VoiceActionResult>;
  availability?(input: unknown): Promise<unknown>;
  createInspection?(input: unknown): Promise<VoiceActionResult>;
  findJob?(input: unknown): Promise<VoiceActionResult>;
  createJob?(input: unknown): Promise<VoiceActionResult>;
  rescheduleJob?(input: unknown): Promise<VoiceActionResult>;
  cancelJob?(input: unknown): Promise<VoiceActionResult>;
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
  if (create) server.tool("create_inspection_request", "Submit one inspection as existing_service with an active service reference, or custom_quote (not sure / need advice) with a scope of work, optional description and no service reference. List services before selecting an existing service; check availability for either type. Advice requests can be scheduled under owner authority using an available staff member permitted to handle quotation/advice requests; otherwise they remain pending. Confirming the visit does not approve work or a quotation. Read back customer contacts, service or scope, full site address and exact preferred sessions and obtain explicit confirmation. Customer account creation is optional; use customerId only from this call's customer tools, or null for a guest. Reuse requestKey on retries. PENDING_REVIEW means received for staff review, CONFIRMED means booked, REJECTED means not accepted, UNKNOWN means staff must verify; never resubmit uncertain outcomes.", inspectionArguments.shape, args => write(() => create(args)));
  const findJob = reads.findJob, createJob = reads.createJob, rescheduleJob = reads.rescheduleJob, cancelJob = reads.cancelJob;
  if (findJob) server.tool("find_job", "Look up one job in this business by its job reference plus the caller's email and mobile on that job. Returns only status, service, date, times, staff name, suburb and whether Sophie may change it. A match is not identity verification; never reveal whether an unmatched reference exists.", jobLookupArguments.shape, args => tool(() => findJob(args)));
  if (createJob) server.tool("create_job_booking", "Book an existing service as a job after listing services and checking availability. Ask for the preferred date first. Once it is clear, ask for optional rough start and finish times before collecting any other details. Each preferred session can include either or both times as HH:MM. Set deferScheduling=true if the caller wants the owner to decide the times. Trade assigns qualified staff only if they are free for the full visit and automatic scheduling is permitted. If deferred or no eligible slot is available, save it for the owner to schedule. Read back service, address, time preferences and contacts and get explicit confirmation. Use customerId only from this call's customer tools, or null for a guest. Reuse requestKey on retries. CONFIRMED means booked at the returned appointment; PENDING_REVIEW means received, not booked; UNKNOWN means staff must verify. Never quote a price.", jobBookingArguments.shape, args => write(() => createJob(args)));
  if (rescheduleJob) server.tool("reschedule_job", "Move a job found with find_job (canChange=true) to one of up to three new preferred sessions, each optionally with an exact start time. Trade keeps the current staff member when free, otherwise picks another qualified one. Read back the new times and obtain explicit confirmation. The original time stays if nothing is free. Reuse requestKey on retries; UNKNOWN means staff must verify.", jobRescheduleArguments.shape, args => write(() => rescheduleJob(args)));
  if (cancelJob) server.tool("cancel_job", "Cancel a job found with find_job (canChange=true) after reading it back and obtaining explicit confirmation. Optional short reason. Never promise refunds or fee waivers. Reuse requestKey on retries; UNKNOWN means staff must verify.", jobCancelArguments.shape, args => write(() => cancelJob(args)));
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
  // Jobs follow the inspection model: bookings are always accepted (pending unless Sophie may confirm);
  // changing an existing job needs the owner's job authority.
  const { createVoiceJobTools } = await import("./tools/job.tools");
  const jobs = await createVoiceJobTools(binding, services.business, defer);
  reads.findJob = jobs.lookup;
  if (schedule && process.env.AI_VOICE_ACTIONS_ENABLED === "true") {
    reads.createJob = jobs.create;
    if ((await services.business()).sophieJobAuthority === true) {
      reads.cancelJob = jobs.cancel;
      if (process.env.AI_AUTO_ASSIGN_STAFF_ENABLED === "true") reads.rescheduleJob = jobs.reschedule;
    }
  }
  return reads;
}
