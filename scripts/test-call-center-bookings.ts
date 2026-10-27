import assert from "node:assert/strict";
import test, { after } from "node:test";
// @ts-expect-error Runtime Node >=22.15 supports hooks; this repo uses Node 20 typings.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookingAgentCanAccess } from "../lib/callcenter/booking-scope";

const aiClaims = { role: "ai_receptionist", aiFrontOffice: true, brand: "trade" };
const agent = () => ({ name: "Trade AI", role: "ai_receptionist", accountType: "ai-front-office", brand: "trade",
  did: "61400000000", businessId: "business-a", assignedBusinessIds: ["business-a"], isActive: true, suspended: false, status: "active" });

test("booking-only AI identities cannot cross businesses or inherit global agent permissions", () => {
  assert.equal(bookingAgentCanAccess("ai", aiClaims, agent(), "business-a", false), true);
  assert.equal(bookingAgentCanAccess("ai", aiClaims, agent(), "business-b", true), false);
  for (const patch of [{ suspended: true }, { isActive: false }, { status: "disabled" }, { brand: "black" },
    { assignedBusinessIds: ["business-a", "business-b"] }, { assignedBusinessIds: [] }]) {
    assert.equal(bookingAgentCanAccess("ai", aiClaims, { ...agent(), ...patch }, "business-a", true), false);
  }
  assert.equal(bookingAgentCanAccess("ai", { role: "call_center" }, agent(), "business-a", true), false);
  assert.equal(bookingAgentCanAccess("ai", aiClaims, undefined, "business-a", true), false);
  assert.equal(bookingAgentCanAccess("human", { role: "call_center" }, { workshopOwnerUid: "business-a" }, "business-a", false), true);
  assert.equal(bookingAgentCanAccess("human", { role: "call_center" }, { workshopOwnerUid: "business-a" }, "business-b", false), false);
});

// Exercise real route handlers and the real booking guard with in-memory
// Firebase/auth/notification boundaries. No live credentials or writes.
const state = {
  agent: agent() as Record<string, unknown>, business: { isActive: true, status: "active", timezone: "Australia/Melbourne", sophieBookingAuthority: true },
  serviceBusiness: "business-a", reads: 0, writes: [] as { businessId: string; options: Record<string, unknown> }[],
  claims: { ...aiClaims, uid: "ai", email: "ai@example.test" } as Record<string, unknown>,
  background: [] as (() => Promise<void>)[], ownerAlerts: 0, notifications: 0, failAudit: false,
  ownerGate: null as Promise<void> | null,
};
(globalThis as any).__bookingSecurityTest = state;
const mocks: Record<string, string> = {
  "next/server": `export const NextResponse={json(value,init){return Response.json(value,init);}}; export const after=task=>globalThis.__bookingSecurityTest.background.push(task);`,
  "lib/auth/account-access": `export async function verifyAccountIdToken(token) { if(token === 'invalid') throw Error('invalid'); return {...globalThis.__bookingSecurityTest.claims}; }`,
  "lib/callcenter/auth": `export async function requireCallCenterAgent() { const s=globalThis.__bookingSecurityTest; return s.claims.role === 'call_center' ? {ok:true,uid:s.claims.uid,isSuperAdmin:false} : {ok:false,status:403,error:'wrong role'}; }`,
  "lib/firebase/admin": `export const adminDb = {collection(collection) { return {doc(id) { return {async get() { const s=globalThis.__bookingSecurityTest; s.reads++; return {data() { if(collection === 'call_center_agents') return s.agent; if(collection === 'businesses') return s.business; if(collection === 'services') return {businessId:s.serviceBusiness,isActive:true}; }}; }}; }}; }};`,
  "lib/onboarding/business-status": `export const isTenantAccessAllowed=(status,active)=>active!==false && status!=='suspended';`,
  "lib/booking/slot-availability": `export async function computeUnavailableSlots(){return [];} export async function validatePreferredSlotsAvailable(){return {ok:true};}`,
  "lib/inspection/server": `export async function createInspectionRequest(businessId,input,options){ const s=globalThis.__bookingSecurityTest; s.writes.push({businessId,options}); const notify=async()=>{s.notifications++;}; if(options.scheduleNotifications)options.scheduleNotifications(notify);else await notify(); return {ok:true,request:{id:'request-a',status:'pending',customer:input.customer,serviceName:'Service'}}; }`,
  "lib/audit/server": `export async function logAuditEvent(){if(globalThis.__bookingSecurityTest.failAudit)throw Error('audit unavailable');}`,
  "lib/notifications/sophie-owner-alert": `export async function sendSophieInspectionOwnerAlert(){const s=globalThis.__bookingSecurityTest;s.ownerAlerts++;await s.ownerGate;}`,
};
const mockDirectory = mkdtempSync(join(tmpdir(), "trade-booking-auth-"));
const mockPaths = new Map<string, string>();
for (const [key, source] of Object.entries(mocks)) {
  const path = join(mockDirectory, `${key.replaceAll("/", "_")}.cjs`);
  writeFileSync(path, source.replace(/export async function (\w+)/g, ";exports.$1 = async function $1").replace(/export const (\w+)\s*=/g, ";exports.$1 ="));
  mockPaths.set(key, path);
}
after(() => { for (const path of mockPaths.values()) unlinkSync(path); rmdirSync(mockDirectory); });
registerHooks({ resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
  const normalized = specifier.replaceAll("\\", "/");
  for (const [key, path] of mockPaths) {
    if (normalized === key || normalized === `@/${key}` || normalized.endsWith(`/${key}.ts`) || normalized.endsWith(`/${key}`)) {
      return { url: pathToFileURL(path).href, format: "commonjs", shortCircuit: true };
    }
  }
  return next(specifier, context);
} });

test("protected Trade routes reject missing/invalid tokens, wrong roles and cross-business requests before writes", async () => {
  const { GET } = await import("../app/api/call-center/bookings/availability/route");
  const { POST } = await import("../app/api/call-center/bookings/route");
  const request = (token: string | null, businessId = "business-a") => new Request("http://local/api/call-center/bookings", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ businessId }),
  });
  assert.equal((await POST(request(null))).status, 401);
  assert.equal((await POST(request("invalid"))).status, 401);
  assert.equal(state.reads, 0);
  state.claims.role = "customer"; state.claims.aiFrontOffice = false;
  assert.equal((await POST(request("customer"))).status, 403);
  Object.assign(state.claims, aiClaims);
  assert.equal((await POST(request("ai", "business-b"))).status, 403);
  state.agent.suspended = true;
  assert.equal((await POST(request("ai"))).status, 403);
  state.agent = agent();
  state.business.isActive = false;
  assert.equal((await POST(request("ai"))).status, 403);
  state.business.isActive = true;
  assert.equal(state.writes.length, 0);
  assert.equal((await GET(new Request("http://local/api/call-center/bookings/availability?businessId=business-a&from=2099-01-05&to=2099-01-06", { headers: { Authorization: "Bearer ai" } }))).status, 200);
  assert.equal((await GET(new Request("http://local/api/call-center/bookings/availability?businessId=business-b&from=2099-01-05&to=2099-01-06", { headers: { Authorization: "Bearer ai" } }))).status, 403);
});

test("Trade validates service ownership and derives customer identity, status and assignment authority server-side", async () => {
  const { POST } = await import("../app/api/call-center/bookings/route");
  const previousFlag = process.env.AI_AUTO_ASSIGN_STAFF_ENABLED;
  process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = "true";
  state.agent = agent(); Object.assign(state.claims, aiClaims);
  state.business.isActive = true;
  const payload = { businessId: "business-a", requestType: "existing_service", serviceId: "service-a",
    customer: { fullName: "Customer Name", email: "customer@example.test", phone: "0400000000" },
    address: { street: "1 Example Street", suburb: "Melbourne", state: "VIC", postcode: "3000" },
    preferredSlots: [{ date: "2099-01-05", timeRange: "morning" }], customerId: "victim", status: "scheduled", aiAutoAssignStaff: true };
  const request = () => new Request("http://local/api/call-center/bookings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer ai" }, body: JSON.stringify(payload) });
  try {
    state.serviceBusiness = "business-b";
    assert.equal((await POST(request())).status, 400);
    assert.equal(state.writes.length, 0);
    state.serviceBusiness = "business-a";
    const response = await POST(request());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).confirmed, false);
    assert.equal(state.writes[0].options.customerId, null);
    assert.equal(state.writes[0].options.autoAssignStaff, true);
    state.business.sophieBookingAuthority = false;
    assert.equal((await POST(request())).status, 200);
    assert.equal(state.writes[1].options.autoAssignStaff, false);
    state.business.sophieBookingAuthority = true;
    state.claims.role = "call_center"; state.claims.aiFrontOffice = false;
    state.agent = { role: "agent", workshopOwnerUid: "business-a", isActive: true };
    assert.equal((await POST(request())).status, 200);
    assert.equal(state.writes[2].options.autoAssignStaff, false);
  } finally {
    if (previousFlag === undefined) delete process.env.AI_AUTO_ASSIGN_STAFF_ENABLED;
    else process.env.AI_AUTO_ASSIGN_STAFF_ENABLED = previousFlag;
  }
});

test("public customer booking rejects the retired AI-signature mode before database access", async () => {
  const { POST } = await import("../app/api/booking/inspection-request/route");
  const before = state.reads;
  const response = await POST(new Request("http://local/api/booking/inspection-request", {
    method: "POST", headers: { "Content-Type": "application/json", "x-bmspro-ai-signature": "retired-signature" },
    body: JSON.stringify({ slug: "business-a" }),
  }));
  assert.equal(response.status, 403);
  assert.equal(state.reads, before);
});

test("a saved booking is acknowledged before slow notifications and failed audit tasks", async () => {
  const { POST } = await import("../app/api/call-center/bookings/route");
  state.agent = agent(); Object.assign(state.claims, aiClaims);
  state.business.isActive = true; state.serviceBusiness = "business-a";
  state.background = []; state.ownerAlerts = 0; state.notifications = 0; state.failAudit = true;
  let release!: () => void;
  state.ownerGate = new Promise<void>(resolve => { release = resolve; });
  try {
    const response = await POST(new Request("http://local/api/call-center/bookings", {
      method: "POST", headers: { Authorization: "Bearer ai", "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: "business-a", requestType: "existing_service", serviceId: "service-a",
        customer: { fullName: "Test Customer", email: "test@example.test", phone: "0400000000" },
        address: { street: "1 Example Street", suburb: "Melbourne", state: "VIC", postcode: "3000" },
        preferredSlots: [{ date: "2099-01-05", timeRange: "morning" }] }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, requestId: "request-a", status: "pending", confirmed: false });
    assert.equal(state.notifications, 0);
    assert.equal(state.ownerAlerts, 0);
    assert.equal(state.background.length, 3);
    const tasks = state.background.splice(0).map(task => task());
    assert.equal(state.ownerAlerts, 1);
    release();
    await Promise.all(tasks);
    assert.equal(state.notifications, 1);
  } finally { release(); state.ownerGate = null; state.failAudit = false; }
});
