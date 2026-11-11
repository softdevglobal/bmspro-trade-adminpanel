import assert from "node:assert/strict";
import test, { after } from "node:test";
// @ts-expect-error Runtime Node supports hooks; the project uses Node 20 typings.
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { didMappingInput, assertMappingVersion } from "../lib/ai/data/did-mapping-types";
import { authenticateVoiceBridge } from "../lib/ai/config";

const state = { docs: new Map<string, Record<string, unknown>>(), reads: 0, writes: 0, audit: [] as unknown[] };
(globalThis as typeof globalThis & { __didMappingTest: typeof state }).__didMappingTest = state;
const sources: Record<string, string> = {
  "lib/firebase/admin": `
    const snap=ref=>({exists:globalThis.__didMappingTest.docs.has(ref.key), data:()=>globalThis.__didMappingTest.docs.get(ref.key)});
    export const adminDb={
      collection(name){const collection={
        doc(id){return {key:name+':'+id, async get(){globalThis.__didMappingTest.reads++;return snap(this);}};},
        select(){return collection;},
        async get(){const s=globalThis.__didMappingTest;s.reads++;return {docs:[...s.docs].filter(([key])=>key.startsWith(name+':')).map(([key,data])=>({id:key.slice(name.length+1),data:()=>data}))};}
      };return collection;},
      async runTransaction(run){return run({async getAll(...refs){globalThis.__didMappingTest.reads+=refs.length;return refs.map(snap);},set(ref,value){globalThis.__didMappingTest.docs.set(ref.key,value);globalThis.__didMappingTest.writes++;}});}
    };`,
  "lib/onboarding/business-status": `export const isTenantAccessAllowed=(status,active)=>active!==false && status!=='suspended';`,
  "lib/onboarding/server": `export async function requireSuperAdmin(request){const token=request.headers.get('authorization');return token==='Bearer admin'?{ok:true,uid:'admin-a',email:'admin@example.test'}:{ok:false,status:token?403:401,error:'Super admin access required.'};}`,
  "lib/audit/server": `export async function logAuditEvent(value){globalThis.__didMappingTest.audit.push(value);}`,
};
const directory = mkdtempSync(join(tmpdir(), "trade-did-mappings-"));
const paths = new Map<string, string>();
for (const [key, source] of Object.entries(sources)) {
  const path = join(directory, key.replaceAll("/", "_") + ".cjs");
  writeFileSync(path, source.replace(/export async function (\w+)/g, ";exports.$1=async function $1").replace(/export const (\w+)\s*=/g, ";exports.$1="));
  paths.set(key, path);
}
registerHooks({ resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
  const normalized = specifier.replaceAll("\\", "/");
  for (const [key, path] of paths) if (normalized === `@/${key}` || normalized.endsWith(`/${key}.ts`) || normalized.endsWith(`/${key}`)) {
    return { url: pathToFileURL(path).href, format: "commonjs", shortCircuit: true };
  }
  return next(specifier, context);
} });
const previousSetup = process.env.AI_VOICE_TRADE_DID_CONFIG_JSON;
after(() => {
  for (const path of paths.values()) unlinkSync(path);
  rmdirSync(directory);
  if (previousSetup === undefined) delete process.env.AI_VOICE_TRADE_DID_CONFIG_JSON;
  else process.env.AI_VOICE_TRADE_DID_CONFIG_JSON = previousSetup;
});
const setup = [{ did: "0359111403", businessId: "business-a" }];
const mapping = { ...setup[0], isActive: true, version: 1 };
const input = { ...mapping, version: 0 };
const request = (token = "admin", body: unknown = input) => new Request("http://localhost/api/admin/ai/did-mappings", {
  method: "PUT", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("mapping validation preserves leading zeros and stale versions cannot overwrite saved entries", () => {
  assert.equal(didMappingInput.parse(input).did, "0359111403");
  for (const patch of [{ did: "+0359111403" }, { did: "0359 111403" }, { businessId: "../business" }, { version: -1 }, { role: "owner" }]) {
    assert.equal(didMappingInput.safeParse({ ...input, ...patch }).success, false);
  }
  assert.throws(() => assertMappingVersion(mapping, 0), /changed/);
});

test("super-admin API rejects other callers before reading or mutating mappings", async () => {
  const { GET, PUT } = await import("../app/api/admin/ai/did-mappings/route");
  for (const token of ["", "owner", "bridge-secret"]) {
    assert.equal((await GET(request(token))).status, token ? 403 : 401);
    assert.equal((await PUT(request(token))).status, token ? 403 : 401);
  }
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
});

test("dashboard saves are unique, version-checked, audited and require an active target", async () => {
  const { GET, PUT } = await import("../app/api/admin/ai/did-mappings/route");
  process.env.AI_VOICE_TRADE_DID_CONFIG_JSON = JSON.stringify(setup);
  state.docs.set("businesses:business-a", { businessName: "Business A", isActive: true, status: "active" });
  state.docs.set("businesses:business-b", { businessName: "Business B", isActive: true, status: "active" });
  const { resolveVoiceDidMapping } = await import("../lib/ai/data/did-mappings");
  assert.equal(await resolveVoiceDidMapping(input.did), null, "environment setup cannot route an unsaved DID");
  assert.equal((await PUT(request("admin", { ...input, businessId: "missing" }))).status, 400);
  assert.equal(state.writes, 0);
  assert.equal((await PUT(request("admin", { ...input, forwardingExtension: "2000" }))).status, 400);
  assert.equal((await PUT(request("admin", { ...input, forwardingExtension: "3101" }))).status, 200);
  assert.equal((await PUT(request())).status, 409, "duplicate create/stale edit cannot overwrite the assignment");
  assert.equal(state.writes, 1);
  assert.equal(state.audit.length, 1);
  const list = await (await GET(request())).json();
  assert.equal(list.mappings.length, 1);
  assert.equal(list.mappings[0].source, "dashboard");
  assert.equal(list.mappings[0].businessName, "Business A");
  assert.equal(list.mappings[0].forwardingExtension, "3101");
  assert.equal((await PUT(request("admin", { ...input, version: 1 }))).status, 200);
  assert.equal(state.docs.get(`ai_did_mappings:${input.did}`)?.forwardingExtension, "3101");
  const reassigned = { ...input, businessId: "business-b", version: 2 };
  assert.equal((await PUT(request("admin", reassigned))).status, 200);
  assert.equal((await resolveVoiceDidMapping(input.did))?.businessId, "business-b");
  assert.equal(state.docs.get(`ai_did_mappings:${input.did}`)?.forwardingExtension, null);
  assert.equal((await PUT(request("admin", { ...reassigned, version: 3, isActive: false }))).status, 200);
  assert.equal(await resolveVoiceDidMapping(input.did), null, "disabled dashboard entry cannot fall back to environment setup");
});

test("authenticated discovery reads dashboard assignments and distinguishes disabled from unmapped numbers", async () => {
  const { POST } = await import("../app/api/ai/voice/route");
  const previousEnabled = process.env.AI_VOICE_DIRECT_ENABLED;
  const previousSecret = process.env.AI_VOICE_BRIDGE_SECRET;
  process.env.AI_VOICE_DIRECT_ENABLED = "true";
  process.env.AI_VOICE_BRIDGE_SECRET = "test-discovery-secret-000000000000000000";
  const discover = (token = process.env.AI_VOICE_BRIDGE_SECRET!) => POST(new Request("http://localhost/api/ai/voice", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "X-BMSPro-DID": input.did },
  }));
  try {
    const readsBefore = state.reads;
    assert.equal((await discover("wrong")).status, 401);
    assert.equal(state.reads, readsBefore);
    state.docs.set(`ai_did_mappings:${input.did}`, { ...mapping, businessId: "business-b", forwardingExtension: "3202" });
    const active = await discover();
    assert.equal(active.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await active.json(), {
      matched: true, brand: "trade", did: input.did, businessId: "business-b",
      profile: { businessName: "Business B", timezone: "Australia/Melbourne" },
      forwardingExtension: "3202",
    });
    state.docs.set("businesses:business-b", { isActive: false, status: "suspended" });
    assert.equal((await discover()).status, 403);
    state.docs.set("businesses:business-b", { isActive: true, status: "active" });
    state.docs.set(`ai_did_mappings:${input.did}`, { ...mapping, isActive: false });
    assert.equal((await discover()).status, 403);
    state.docs.delete(`ai_did_mappings:${input.did}`);
    assert.deepEqual(await (await discover()).json(), { matched: false, did: input.did });
    state.docs.set(`ai_did_mappings:${input.did}`, { did: input.did, businessId: "business-b", isActive: true });
    assert.equal((await discover()).status, 503, "corrupt mappings cannot fall back to setup");
  } finally {
    if (previousEnabled === undefined) delete process.env.AI_VOICE_DIRECT_ENABLED;
    else process.env.AI_VOICE_DIRECT_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.AI_VOICE_BRIDGE_SECRET;
    else process.env.AI_VOICE_BRIDGE_SECRET = previousSecret;
  }
});

test("bridge uses live dashboard mapping, rejects stale call bindings and denies lookup outages", async () => {
  const env = { AI_VOICE_DIRECT_ENABLED: "true", AI_VOICE_BRIDGE_SECRET: "test-bridge-secret-00000000000000000" };
  const bridgeRequest = (businessId?: string) => new Request("http://localhost/api/ai/mcp", { headers: {
    Authorization: `Bearer ${env.AI_VOICE_BRIDGE_SECRET}`, "X-BMSPro-DID": input.did,
    ...(businessId ? { "X-BMSPro-Trade-Business": businessId } : {}),
  } });
  const lookup = async () => ({ did: input.did, businessId: "business-b" });
  assert.equal((await authenticateVoiceBridge(bridgeRequest(), env, lookup)).ok, true);
  const stale = await authenticateVoiceBridge(bridgeRequest("business-a"), env, lookup);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.status, 403);
  const unavailable = await authenticateVoiceBridge(bridgeRequest(), env, async () => { throw new Error("Database unavailable"); });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.status, 503);
  assert.equal((await authenticateVoiceBridge(bridgeRequest(), env, async () => null)).ok, false);
});
