import assert from "node:assert/strict";
import test from "node:test";
import { jobActions, type VoiceJobDependencies } from "../lib/ai/mcp/tools/job.tools";
import { runVoiceOperation, type VoiceOperationRecord, type VoiceOperationStore } from "../lib/ai/mcp/tools/operation";
import { planTradeStaffAssignment } from "../lib/team/ai-assignment-planner";
import { jobLookupArguments } from "../lib/ai/mcp/tools/action-schemas";
import type { BookingDetail } from "../lib/bookings/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleTradeVoiceMcp } from "../lib/ai/mcp/mcp-server";

const binding = { did: "0359111403", businessId: "business-a" };
const customer = { fullName: "Test Customer", email: "test@example.test", phone: "0412345678" };
const address = { street: "1 Test St", suburb: "Lynbrook", state: "VIC", postcode: "3975" };
const contact = { email: customer.email, phone: customer.phone };
const jobCode = "BK 4K7H2M9PQ";
const now = () => new Date("2099-01-01T00:00:00Z");

function job(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return { id: "job-a", businessId: binding.businessId, bookingCode: jobCode, inspectionRequestId: "req", inspectionRequestCode: null, quotationId: null,
    status: "scheduled", requestType: "existing_service", serviceId: "service-a", serviceName: "Switchboard upgrade", serviceBusinessType: null,
    customRequest: null, customer, customerId: null, address, scheduledSlot: { date: "2099-01-10", timeRange: "morning" },
    scheduledStartTime: "09:00", scheduledEndTime: "11:00", additionalJobDays: [], estimatedDurationMinutes: 120,
    assignedTo: { type: "staff", uid: "staff-a", name: "Alex", email: null }, ownerNote: null, jobInstructionsDescription: null,
    jobInstructionsTasks: [], seriesId: null, seriesIndex: null, seriesCount: null, recurrence: null, seriesException: false, requiredSkill: null,
    quotation: null, visitStartedAt: null, visitEndedAt: null, bookingStartedAt: null, completedFromInvoice: false, beforeImageUrls: [],
    afterImageUrls: [], cancelledAt: null, missedReason: null, missedFollowUp: null, missedAt: null, careplusSourceRevision: 0,
    careplusScheduled: false, createdAt: null, updatedAt: null, ...overrides } as BookingDetail;
}

function fixture() {
  const records = new Map<string, VoiceOperationRecord>();
  const store: VoiceOperationStore = {
    async claim(key, fingerprint) { const previous = records.get(key); if (previous) return previous; records.set(key, { fingerprint }); return null; },
    async complete(key, result) { records.get(key)!.result = result; },
  };
  const state = { authority: true, writes: true, stored: job(), free: new Set(["2099-01-12:morning"]), full: false, creates: 0, moves: 0, cancels: 0,
    events: [] as string[], planned: [] as Array<{ slot: unknown; staffUids?: string[] }>, raceOnce: false, auto: true, pending: [] as Array<{ reason: string; preferredSlots: unknown[] }> };
  const deps: VoiceJobDependencies = {
    business: async () => ({ timezone: "Australia/Melbourne", sophieJobAuthority: state.authority }),
    service: async id => id === "service-a" ? { name: "Switchboard upgrade", durationMinutes: 120 } : null,
    customer: async () => undefined,
    findJob: async code => code === jobCode ? state.stored : null,
    plan: async ({ slot, staffUids }) => {
      state.planned.push({ slot, staffUids });
      const key = `${slot.date}:${slot.timeRange}`;
      if (!state.free.has(key) || (staffUids && !staffUids.includes("staff-a"))) return { ok: false, reason: "busy" };
      const startTime = slot.startTime ?? (slot.timeRange === "morning" ? "08:00" : "12:00");
      const end = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + 120;
      return { ok: true, assignedTo: { type: "staff", uid: "staff-a", name: "Alex", email: null }, slot: { date: slot.date, timeRange: slot.timeRange },
        startTime, endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` };
    },
    capacityFull: async () => state.full,
    create: async (_input, plan) => {
      if (state.raceOnce) { state.raceOnce = false; return { ok: false, error: "taken", planChanged: true }; }
      state.creates++;
      return { ok: true, booking: job({ id: "job-new", bookingCode: "BK 22222222Z", scheduledSlot: plan.slot, scheduledStartTime: plan.startTime, scheduledEndTime: plan.endTime }) };
    },
    move: async (current, plan) => { state.moves++; state.stored = { ...current, scheduledSlot: plan.slot, scheduledStartTime: plan.startTime, scheduledEndTime: plan.endTime }; return { ok: true, booking: state.stored }; },
    cancel: async current => { state.cancels++; state.stored = { ...current, status: "cancelled" }; return { ok: true, booking: state.stored }; },
    writesEnabled: () => state.writes,
    autoConfirmEnabled: () => state.auto,
    createPending: async input => { state.pending.push(input); return { ok: true, request: { id: "request-pending" } as never }; },
    requested: () => { state.events.push("requested"); },
    once: (operation, key, details, send) => runVoiceOperation(store, binding.businessId, operation, key, details, send),
    done: event => { state.events.push(event.kind); },
    now,
  };
  return { state, actions: jobActions(binding, deps) };
}

const booking = (overrides: Record<string, unknown> = {}) => ({ requestKey: "job-booking-key-0001", customerConfirmed: true, serviceId: "service-a",
  customerId: null, customer, address, preferredSlots: [{ date: "2099-01-12", timeRange: "morning", startTime: "10:30" }], ...overrides });

test("spoken job references normalise to the stored BK code and reject lookalike characters", () => {
  assert.equal(jobLookupArguments.parse({ ...contact, jobCode: "bk 4k7h 2m9pq" }).jobCode, jobCode);
  assert.equal(jobLookupArguments.parse({ ...contact, jobCode: "4K7H2M9PQ" }).jobCode, jobCode);
  assert.equal(jobLookupArguments.safeParse({ ...contact, jobCode: "BK 4K7H2M9P0" }).success, false);
});

test("job booking honours the caller's exact start time and needs owner authority", async () => {
  const { state, actions } = fixture();
  const result = await actions.create(booking());
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.appointment?.startTime, "10:30"); assert.equal(result.appointment?.endTime, "12:30");
  assert.equal(result.appointment?.inspectorName, "Alex"); assert.equal(result.jobCode, "BK 22222222Z");
  assert.deepEqual(state.events, ["booked"]);
  assert.equal((await actions.create(booking())).status, "CONFIRMED"); assert.equal(state.creates, 1);
  // Like inspections: without owner authority or staff automation the job waits for the team instead of being refused.
  state.authority = false;
  const pending = await actions.create(booking({ requestKey: "job-booking-key-0002" }));
  assert.equal(pending.status, "PENDING_REVIEW"); assert.equal(pending.code, "JOB_REVIEW_REQUIRED"); assert.equal(pending.requestId, "request-pending");
  state.authority = true; state.auto = false;
  assert.equal((await actions.create(booking({ requestKey: "job-booking-key-0007" }))).code, "JOB_REVIEW_REQUIRED");
  assert.equal(state.pending.length, 2); assert.deepEqual(state.pending[0]?.preferredSlots, [{ date: "2099-01-12", timeRange: "morning", startTime: "10:30" }]);
  state.auto = true; state.writes = false;
  assert.equal((await actions.create(booking({ requestKey: "job-booking-key-0003" }))).status, "REJECTED");
  assert.equal(state.creates, 1); assert.deepEqual(state.events, ["booked", "requested", "requested"]);
});

test("job booking falls through busy or full sessions and retries once a concurrent booking wins", async () => {
  const { state, actions } = fixture();
  const slots = [{ date: "2099-01-11", timeRange: "morning", startTime: null }, { date: "2099-01-12", timeRange: "morning", startTime: null }];
  state.raceOnce = true; state.free.add("2099-01-12:afternoon");
  const result = await actions.create(booking({ preferredSlots: [...slots, { date: "2099-01-12", timeRange: "afternoon", startTime: null }] }));
  assert.equal(result.status, "CONFIRMED"); assert.equal(result.appointment?.session, "afternoon");
  state.full = true;
  const waiting = await actions.create(booking({ requestKey: "job-booking-key-0004" }));
  assert.equal(waiting.status, "PENDING_REVIEW"); assert.equal(waiting.code, "STAFF_ASSIGNMENT_REVIEW_REQUIRED");
  assert.equal((await actions.create(booking({ requestKey: "job-booking-key-0005", serviceId: "service-z" }))).status, "REJECTED");
  assert.equal((await actions.create(booking({ requestKey: "job-booking-key-0006", customerConfirmed: false }))).status, "REJECTED");
});

test("lookup needs the reference plus both contacts and reveals only a summary", async () => {
  const { state, actions } = fixture();
  const found = await actions.lookup({ jobCode, ...contact });
  assert.equal(found.status, "MATCHED"); assert.equal(found.job?.canChange, true); assert.equal(found.job?.staffName, "Alex");
  assert.equal(JSON.stringify(found).includes("1 Test St"), false);
  assert.equal((await actions.lookup({ jobCode, ...contact, phone: "0499999999" })).status, "NOT_FOUND");
  assert.equal((await actions.lookup({ jobCode: "BK 99999999Z", ...contact })).status, "NOT_FOUND");
  state.stored = job({ businessId: "other" });
  assert.equal((await actions.lookup({ jobCode, ...contact })).status, "NOT_FOUND");
  state.stored = job({ seriesId: "series-a" });
  assert.equal((await actions.lookup({ jobCode, ...contact })).job?.canChange, false);
});

test("reschedule keeps the current staff member first and never moves team-only jobs", async () => {
  const { state, actions } = fixture();
  const args = { requestKey: "job-move-key-00001", customerConfirmed: true, jobCode, ...contact, preferredSlots: [{ date: "2099-01-12", timeRange: "morning", startTime: "09:15" }] };
  const moved = await actions.reschedule(args);
  assert.equal(moved.status, "CONFIRMED"); assert.equal(moved.appointment?.startTime, "09:15");
  assert.deepEqual(state.planned[0]?.staffUids, ["staff-a"]); assert.equal(state.moves, 1);
  state.auto = false;
  assert.equal((await actions.reschedule({ ...args, requestKey: "job-move-key-00002" })).code, "JOB_AUTHORITY_REQUIRED");
  state.auto = true;
  for (const overrides of [{ status: "ongoing" as const }, { additionalJobDays: [{ date: "2099-01-11", timeRange: "morning" as const }] },
    { scheduledSlot: { date: "2099-01-01", timeRange: "morning" as const } }, { requestType: "custom_quote" as const, serviceId: null }]) {
    state.stored = job(overrides);
    const result = await actions.reschedule({ ...args, requestKey: `job-move-key-${state.moves}${Math.random()}` });
    assert.equal(result.code, "TEAM_ACTION_REQUIRED");
  }
  assert.equal(state.moves, 1);
  state.stored = job(); state.free.clear();
  assert.equal((await actions.reschedule({ ...args, requestKey: "job-move-key-00009" })).code, "NO_AVAILABLE_TIME");
});

test("cancel requires a matching job, confirmation and an unstarted future visit", async () => {
  const { state, actions } = fixture();
  const args = { requestKey: "job-cancel-key-0001", customerConfirmed: true, jobCode, ...contact, reason: "No longer needed" };
  assert.equal((await actions.cancel({ ...args, customerConfirmed: false })).status, "REJECTED");
  assert.equal((await actions.cancel({ ...args, requestKey: "job-cancel-key-0002", email: "other@example.test" })).status, "NOT_FOUND");
  assert.equal((await actions.cancel(args)).status, "CANCELLED");
  assert.equal(state.cancels, 1); assert.deepEqual(state.events, ["cancelled"]);
  assert.equal((await actions.cancel(args)).status, "CANCELLED"); assert.equal(state.cancels, 1);
});

const member = { id: "staff-a", role: "staff", status: "active", fullName: "Alex", availability: ["Weekdays", "Saturdays", "Sundays"], serviceIds: ["service-a"] };
const planInput = (overrides: Record<string, unknown> = {}) => ({ service: { id: "service-a", isActive: true }, staff: [member], leave: [], work: [] as Record<string, unknown>[],
  closures: [], timezone: "Australia/Melbourne", workingHours: { startTime: "07:00", endTime: "18:00" }, now: new Date("2099-01-01T00:00:00Z"),
  durationMinutes: 240, travelBufferMinutes: 30, slots: [{ date: "2099-01-12", timeRange: "afternoon" }], ...overrides });

test("planner: exact start, jobs may run past the session, multi-day job days count as busy", () => {
  assert.equal(planTradeStaffAssignment(planInput({ durationMinutes: 360 })).assignedTo, null);
  const long = planTradeStaffAssignment(planInput({ durationMinutes: 360, allowRunPastSession: true }));
  assert.equal(long.aiAssignment.proposedSlot?.startTime, "12:00"); assert.equal(long.aiAssignment.proposedSlot?.endTime, "18:00");
  const exact = planTradeStaffAssignment(planInput({ slots: [{ date: "2099-01-12", timeRange: "afternoon", startTime: "13:30" }], allowRunPastSession: true }));
  assert.equal(exact.aiAssignment.proposedSlot?.startTime, "13:30");
  assert.equal(planTradeStaffAssignment(planInput({ slots: [{ date: "2099-01-12", timeRange: "morning", startTime: "13:30" }] })).assignedTo, null);
  const multiDay = { status: "scheduled", assignedTo: { uid: "staff-a" }, scheduledSlot: { date: "2099-01-11", timeRange: "morning" }, scheduledStartTime: "08:00",
    scheduledEndTime: "16:00", additionalJobDays: [{ date: "2099-01-12", timeRange: "morning", startTime: "08:00", endTime: "16:00" }] };
  assert.equal(planTradeStaffAssignment(planInput({ work: [multiDay] })).assignedTo, null);
  const exactBusy = planTradeStaffAssignment(planInput({ durationMinutes: 60, allowRunPastSession: true, work: [{ ...multiDay, additionalJobDays: [{ date: "2099-01-12", timeRange: "afternoon", startTime: "13:00", endTime: "14:00" }] }],
    slots: [{ date: "2099-01-12", timeRange: "afternoon", startTime: "13:30" }] }));
  assert.equal(exactBusy.assignedTo, null);
});

test("real MCP advertises job tools only when provided and validates consent before dispatch", async () => {
  let writes = 0;
  const client = new Client({ name: "trade-jobs-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: async (url, init) => handleTradeVoiceMcp(new Request(url, init), {
      profile: async () => ({}), services: async () => [], findJob: async () => ({ status: "NOT_FOUND", message: "none" }),
      cancelJob: async () => { writes++; return { status: "CANCELLED", message: "done" }; },
    }) }));
    const names = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ["cancel_job", "find_job", "get_business_profile", "list_services"]);
    const args = { requestKey: "mcp-cancel-key-0001", jobCode, ...contact };
    assert.equal((await client.callTool({ name: "cancel_job", arguments: { ...args, customerConfirmed: false } })).isError, true);
    assert.equal(writes, 0);
    assert.notEqual((await client.callTool({ name: "cancel_job", arguments: { ...args, customerConfirmed: true } })).isError, true);
    assert.equal(writes, 1);
  } finally { await client.close(); }
});
