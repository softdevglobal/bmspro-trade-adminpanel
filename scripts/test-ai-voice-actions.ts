import assert from "node:assert/strict";
import test from "node:test";
import { customerActions, type VoiceCustomerDependencies } from "../lib/ai/mcp/tools/customer.tools";
import { bookingActions, type VoiceBookingDependencies } from "../lib/ai/mcp/tools/booking.tools";
import { runVoiceOperation, type VoiceOperationStore, type VoiceOperationRecord } from "../lib/ai/mcp/tools/operation";
import type { InspectionRequestDetail } from "../lib/inspection/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleTradeVoiceMcp } from "../lib/ai/mcp/mcp-server";

const binding = { did: "0359111403", businessId: "business-a" };
const customer = { fullName: "Test Customer", email: "test@example.test", phone: "0412345678" };
const profile = { ...customer, registeredBusinessId: binding.businessId };
function ledger() {
  const records = new Map<string, VoiceOperationRecord>();
  const store: VoiceOperationStore = {
    async claim(key, fingerprint) { const previous = records.get(key); if (previous) return previous; records.set(key, { fingerprint }); return null; },
    async complete(key, result) { records.get(key)!.result = result; },
  };
  return { store, once: (key: string, details: unknown, send: Parameters<typeof runVoiceOperation>[5]) => runVoiceOperation(store, binding.businessId, "test", key, details, send) };
}
test("durable claims prevent concurrent, interrupted and changed-detail duplicate writes", async () => {
  const { store } = ledger(); let writes = 0;
  const send = async () => { writes++; return { status: "CREATED" as const, message: "saved" }; };
  const run = (details = { a: 1, b: 2 }) => runVoiceOperation(store, "a", "register", "key", details, send);
  const results = await Promise.all([run(), run()]);
  assert.equal(writes, 1); assert.ok(results.some(r => r.status === "CREATED"));
  assert.equal((await run({ b: 2, a: 1 })).status, "CREATED");
  assert.equal((await run({ a: 3, b: 2 })).code, "REQUEST_KEY_CONFLICT");
  await runVoiceOperation(store, "b", "register", "key", {}, send);
  await runVoiceOperation(store, "a", "book", "key", {}, send);
  assert.equal(writes, 3);
  const failing = async () => { writes++; throw Error("uncertain write"); };
  assert.equal((await runVoiceOperation(store, "a", "register", "other", {}, failing)).status, "UNKNOWN");
  assert.equal((await runVoiceOperation(store, "a", "register", "other", {}, failing)).status, "UNKNOWN");
  assert.equal(writes, 4);
});
test("customer tools require consent, preserve existing profiles and disclose references only", async () => {
  let records = [{ id: "customer-a", data: profile }], ensured = 0, notifications = 0, enabled = true, writes = true;
  const deps: VoiceCustomerDependencies = {
    business: async () => ({}), find: async () => records, enabled: async () => enabled, writesEnabled: () => writes,
    ensure: async () => { ensured++; return { uid: "new-customer", created: true }; },
    created: () => { notifications++; }, once: ledger().once,
  };
  const actions = customerActions(binding, deps);
  const match = await actions.find({ email: customer.email, phone: customer.phone });
  assert.equal(match.status, "MATCHED"); assert.equal(match.customerId, "customer-a");
  assert.equal(JSON.stringify(match).includes(customer.email), false);
  assert.equal((await actions.find({ email: customer.email, phone: "0499999999" })).status, "NOT_FOUND");
  records = [{ id: "foreign", data: { ...profile, registeredBusinessId: "other" } }];
  assert.equal((await actions.find({ email: customer.email, phone: customer.phone })).status, "NOT_FOUND");
  const args = { requestKey: "registration-key-0001", customerConfirmed: true, customer };
  assert.equal((await actions.register(args)).status, "REJECTED"); assert.equal(ensured, 0);
  records = [{ id: "customer-a", data: profile }]; enabled = false;
  assert.equal((await actions.register({ ...args, requestKey: "registration-key-0002" })).status, "REJECTED");
  enabled = true;
  assert.equal((await actions.register({ ...args, requestKey: "registration-key-0003" })).status, "EXISTS"); assert.equal(ensured, 0);
  records = [];
  assert.equal((await actions.register({ ...args, customerConfirmed: false })).status, "REJECTED");
  const fresh = { ...args, requestKey: "registration-key-0004" };
  assert.equal((await actions.register(fresh)).status, "CREATED");
  assert.equal((await actions.register(fresh)).status, "CREATED");
  assert.equal(ensured, 1); assert.equal(notifications, 1);
  writes = false; assert.equal((await actions.register({ ...args, requestKey: "registration-key-0005" })).status, "REJECTED");
});
test("inspection tools validate scoped references/live availability and return actual booking status", async () => {
  let writes = 0, notifications = 0, activeService = true, slots = true, linked = profile, authority = false, scheduled = false, missingInspector = false;
  const auto: boolean[] = [];
  const deps: VoiceBookingDependencies = {
    business: async () => ({ timezone: "Australia/Melbourne", sophieBookingAuthority: authority }),
    activeService: async () => activeService, customer: async () => linked, unavailable: async () => [],
    validateSlots: async () => slots ? { ok: true } : { ok: false, error: "Session unavailable" },
    writesEnabled: () => true, once: ledger().once, created: () => { notifications++; },
    create: async (_input, _customerId, confirm) => { writes++; auto.push(confirm); return { ok: true, request: { id: "request-a", status: scheduled ? "scheduled" : "pending",
      scheduledSlot: scheduled ? { date: "2099-11-05", timeRange: "morning" } : null, scheduledStartTime: "09:00", scheduledEndTime: "10:00",
      assignedTo: scheduled && !missingInspector ? { type: "staff", uid: "staff-a", name: "Test Inspector", email: "private-staff@example.test" } : null } as InspectionRequestDetail }; },
  };
  const actions = bookingActions(binding, deps);
  const args = { requestKey: "inspection-key-00001", customerConfirmed: true, serviceId: "service-a", customerId: "customer-a", customer,
    address: { street: "1 Test Street", suburb: "Lynbrook", state: "VIC", postcode: "3975" }, preferredSlots: [{ date: "2099-11-05", timeRange: "morning" }] };
  let counter = 0;
  const attempt = (patch = {}) => actions.create({ ...args, requestKey: `inspection-key-${++counter}-0000`, ...patch });
  assert.equal((await attempt({ customerConfirmed: false })).status, "REJECTED");
  activeService = false; assert.equal((await attempt()).status, "REJECTED"); activeService = true;
  linked = { ...profile, registeredBusinessId: "other" }; assert.equal((await attempt()).status, "REJECTED"); linked = profile;
  slots = false; assert.equal((await attempt()).status, "REJECTED"); slots = true;
  assert.equal((await attempt({ preferredSlots: [{ date: "2000-01-01", timeRange: "morning" }] })).status, "REJECTED");
  assert.equal(writes, 0);
  const before = process.env.AI_AUTO_ASSIGN_STAFF_ENABLED;
  try {
    process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = "true";
    assert.equal((await actions.create(args)).status, "PENDING_REVIEW");
    assert.equal((await actions.create(args)).status, "PENDING_REVIEW");
    assert.equal(writes, 1); assert.equal(notifications, 1); assert.deepEqual(auto, [false]);
    authority = true; scheduled = true;
    const confirmed = await attempt({ customerId: null });
    assert.equal(confirmed.status, "CONFIRMED"); assert.equal(auto.at(-1), true);
    assert.deepEqual(confirmed.appointment, { date: "2099-11-05", session: "morning", startTime: "09:00", endTime: "10:00", timezone: "Australia/Melbourne", inspectorName: "Test Inspector" });
    assert.equal(JSON.stringify(confirmed).includes("private-staff@example.test"), false);
    assert.equal(JSON.stringify(confirmed).includes("staff-a"), false);
    scheduled = false;
    const pending = await attempt({ customerId: null });
    assert.equal(pending.status, "PENDING_REVIEW");
    assert.equal(pending.code, "STAFF_ASSIGNMENT_REVIEW_REQUIRED");
    assert.equal(pending.appointment, undefined);
    scheduled = true; missingInspector = true;
    const unverified = await attempt({ customerId: null });
    assert.equal(unverified.status, "UNKNOWN"); assert.equal(unverified.code, "ASSIGNMENT_UNVERIFIED");
    assert.equal(unverified.appointment, undefined);
    missingInspector = false;
    process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = "false";
    await attempt({ customerId: null }); assert.equal(auto.at(-1), false);
    await assert.rejects(actions.availability({ from: "2099-01-01", to: "2099-12-31" }));
    assert.deepEqual((await actions.availability({ from: "2099-11-05", to: "2099-11-05" })).unavailable, []);
  } finally { if (before === undefined) delete process.env.AI_AUTO_ASSIGN_STAFF_ENABLED; else process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = before; }
});
test("real MCP advertises six tools and validates consent before dispatching writes", async () => {
  let writes = 0;
  const client = new Client({ name: "trade-actions-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: async (url, init) => handleTradeVoiceMcp(new Request(url, init), {
      profile: async () => ({}), services: async () => [], findCustomer: async () => ({ status: "NOT_FOUND", message: "none" }), availability: async () => [],
      registerCustomer: async () => { writes++; return { status: "CREATED", customerId: "new", message: "saved" }; },
      createInspection: async () => { throw Error("private error"); },
    }) }));
    assert.equal((await client.listTools()).tools.length, 6);
    assert.equal((await client.callTool({ name: "register_customer", arguments: { customer, requestKey: "mcp-registration-001", customerConfirmed: false } })).isError, true);
    assert.equal(writes, 0);
    const result = await client.callTool({ name: "register_customer", arguments: { customer, requestKey: "mcp-registration-001", customerConfirmed: true } });
    assert.notEqual(result.isError, true); assert.equal(writes, 1);
    assert.equal((await client.callTool({ name: "cancel_booking", arguments: {} })).isError, true);
  } finally { await client.close(); }
});

test("advice requests preserve scope and allow scheduling only under business authority", async () => {
  const received: { input: unknown; autoConfirm: boolean }[] = [];
  let available = true, authority = true, scheduled = false;
  const actions = bookingActions(binding, {
    business: async () => ({ timezone: "Australia/Melbourne", sophieBookingAuthority: authority }),
    activeService: async () => { throw Error("Advice must not choose or look up a service."); },
    customer: async () => undefined, unavailable: async () => [], writesEnabled: () => true,
    validateSlots: async () => available ? { ok: true } : { ok: false, error: "Session unavailable" },
    once: ledger().once, created: () => {},
    create: async (input, _customerId, autoConfirm) => {
      received.push({ input, autoConfirm });
      return { ok: true, request: { id: "advice-request", status: scheduled && autoConfirm ? "scheduled" : "pending",
        ...(scheduled && autoConfirm ? { assignedTo: { type: "staff", uid: "inspector-a", name: "Advice Inspector" },
          scheduledSlot: input.preferredSlots[0], scheduledStartTime: "08:00", scheduledEndTime: "09:00" } : {}) } as InspectionRequestDetail };
    },
  });
  const args = { requestKey: "advice-request-key-001", customerConfirmed: true, requestType: "custom_quote", serviceId: null,
    customRequest: { title: "Check a recurring power issue" }, customer,
    address: { street: "1 Test Street", suburb: "Lynbrook", state: "VIC", postcode: "3975" },
    preferredSlots: [{ date: "2099-11-05", timeRange: "morning" }, { date: "2099-11-06", timeRange: "afternoon" }] };
  const before = process.env.AI_AUTO_ASSIGN_STAFF_ENABLED;
  try {
    process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = "true";
    assert.equal((await actions.create({ ...args, serviceId: "invented" })).status, "REJECTED");
    assert.equal((await actions.create({ ...args, customRequest: { title: "ab" } })).status, "REJECTED");
    assert.equal((await actions.create({ ...args, requestType: "existing_service", serviceId: "service-a" })).status, "REJECTED");
    assert.equal((await actions.create({ ...args, customRequest: { title: "Valid scope", description: "x".repeat(1501) } })).status, "REJECTED");
    assert.equal((await actions.create({ ...args, customerConfirmed: false })).status, "REJECTED");
    available = false;
    assert.equal((await actions.create({ ...args, requestKey: "advice-request-key-002" })).status, "REJECTED");
    assert.equal(received.length, 0); available = true;
    const result = await actions.create(args);
    assert.equal(result.status, "PENDING_REVIEW"); assert.equal(result.code, "STAFF_ASSIGNMENT_REVIEW_REQUIRED");
    assert.equal(result.appointment, undefined);
    await actions.create(args); assert.equal(received.length, 1);
    const input = received[0].input as Record<string, unknown>;
    assert.equal(input.requestType, "custom_quote"); assert.equal(input.serviceId, null);
    assert.deepEqual(input.customRequest, { title: args.customRequest.title, description: "" });
    assert.deepEqual(input.preferredSlots, args.preferredSlots); assert.equal(received[0].autoConfirm, true);
    assert.equal((await actions.create({ ...args, customRequest: { title: "Changed scope" } })).code, "REQUEST_KEY_CONFLICT");
    scheduled = true;
    const confirmed = await actions.create({ ...args, requestKey: "advice-request-key-003" });
    assert.equal(confirmed.status, "CONFIRMED"); assert.equal(confirmed.appointment?.inspectorName, "Advice Inspector");
    authority = false;
    const unauthorized = await actions.create({ ...args, requestKey: "advice-request-key-004" });
    assert.equal(unauthorized.status, "PENDING_REVIEW"); assert.equal(received.at(-1)?.autoConfirm, false);
    assert.equal(unauthorized.code, "CUSTOM_REQUEST_REVIEW_REQUIRED");
    authority = true; process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = "false";
    assert.equal((await actions.create({ ...args, requestKey: "advice-request-key-005" })).status, "PENDING_REVIEW");
    assert.equal(received.at(-1)?.autoConfirm, false);
  } finally { if (before === undefined) delete process.env.AI_AUTO_ASSIGN_STAFF_ENABLED; else process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = before; }
});

test("real MCP accepts advice schema without a service ID and rejects oversized scope before dispatch", async () => {
  const client = new Client({ name: "advice-schema-test", version: "1" });
  let received: Record<string, unknown> | undefined;
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: async (url, init) => handleTradeVoiceMcp(new Request(url, init), {
      profile: async () => ({}), services: async () => [],
      createInspection: async input => { received = input as Record<string, unknown>; return { status: "PENDING_REVIEW", requestId: "advice-a", message: "Saved" }; },
    }) }));
    const args = { requestKey: "advice-mcp-test-001", customerConfirmed: true, requestType: "custom_quote",
      customRequest: { title: "Need advice on a fault" }, customer,
      address: { street: "1 Test Street", suburb: "Lynbrook", state: "VIC", postcode: "3975" }, preferredSlots: [{ date: "2099-11-05", timeRange: "morning" }] };
    const result = await client.callTool({ name: "create_inspection_request", arguments: args });
    assert.notEqual(result.isError, true); assert.equal(received?.serviceId, null);
    assert.equal(received?.requestType, "custom_quote");
    assert.deepEqual(received?.customRequest, { title: args.customRequest.title, description: "" });
    received = undefined;
    assert.equal((await client.callTool({ name: "create_inspection_request", arguments: { ...args, customRequest: { title: "x".repeat(121) } } })).isError, true);
    assert.equal(received, undefined);
  } finally { await client.close(); }
});
