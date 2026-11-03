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
  let writes = 0, notifications = 0, activeService = true, slots = true, linked = profile, authority = false, scheduled = false;
  const auto: boolean[] = [];
  const deps: VoiceBookingDependencies = {
    business: async () => ({ timezone: "Australia/Melbourne", sophieBookingAuthority: authority }),
    activeService: async () => activeService, customer: async () => linked, unavailable: async () => [],
    validateSlots: async () => slots ? { ok: true } : { ok: false, error: "Session unavailable" },
    writesEnabled: () => true, once: ledger().once, created: () => { notifications++; },
    create: async (_input, _customerId, confirm) => { writes++; auto.push(confirm); return { ok: true, request: { id: "request-a", status: scheduled ? "scheduled" : "pending",
      scheduledSlot: scheduled ? { date: "2099-11-05", timeRange: "morning" } : null, scheduledStartTime: "09:00", scheduledEndTime: "10:00" } as InspectionRequestDetail }; },
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
    assert.deepEqual(confirmed.appointment, { date: "2099-11-05", session: "morning", startTime: "09:00", endTime: "10:00", timezone: "Australia/Melbourne" });
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
