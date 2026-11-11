import assert from "node:assert/strict";
import test, { after } from "node:test";
// @ts-expect-error Runtime Node supports hooks; the project uses Node 20 typings.
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Timestamp } from "firebase-admin/firestore";
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
        where(field,operator,value){return {select(){return this;},async get(){const result=await collection.get();return {docs:result.docs.filter(doc=>doc.data()[field]===value)};}};},
        async get(){const s=globalThis.__didMappingTest;s.reads++;return {docs:[...s.docs].filter(([key])=>key.startsWith(name+':')).map(([key,data])=>({id:key.slice(name.length+1),data:()=>data}))};}
      };return collection;},
      async runTransaction(run){return run({async get(ref){return snap(ref);},async getAll(...refs){globalThis.__didMappingTest.reads+=refs.length;return refs.map(snap);},update(ref,value){this.set(ref,value,{merge:true});},set(ref,value,options){const s=globalThis.__didMappingTest;s.docs.set(ref.key,options?.merge?{...s.docs.get(ref.key),...value}:value);s.writes++;}});}
    };`,
  "lib/onboarding/business-status": `export const isTenantAccessAllowed=(status,active)=>active!==false && status!=='suspended';`,
  "lib/onboarding/server": `
    export async function requireSuperAdmin(request){const token=request.headers.get('authorization');return token==='Bearer admin'?{ok:true,uid:'admin-a',email:'admin@example.test'}:{ok:false,status:token?403:401,error:'Super admin access required.'};}
    export async function requireBusinessMember(request){const uid=request.headers.get('authorization')?.slice(7);return {ok:true,uid,role:uid==='staff-a'?'staff':'owner',businessId:'sophie-permissions-business'};}
  `,
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
  assert.equal(state.writes, 2);
  const periodKey = `ai_did_recording_periods:${input.did}-1`;
  assert.equal(state.docs.get(periodKey)?.businessId, "business-a");
  assert.equal(state.docs.get(periodKey)?.endedAt, null);
  assert.equal(state.audit.length, 1);
  const list = await (await GET(request())).json();
  assert.equal(list.mappings.length, 1);
  assert.equal(list.mappings[0].source, "dashboard");
  assert.equal(list.mappings[0].businessName, "Business A");
  assert.equal(list.mappings[0].forwardingExtension, "3101");
  assert.equal((await PUT(request("admin", { ...input, version: 1 }))).status, 200);
  assert.equal(state.docs.get(`ai_did_mappings:${input.did}`)?.forwardingExtension, "3101");
  assert.equal(state.docs.get(`ai_did_mappings:${input.did}`)?.recordingPeriodVersion, 1);
  const reassigned = { ...input, businessId: "business-b", version: 2 };
  assert.equal((await PUT(request("admin", reassigned))).status, 200);
  assert.equal((await resolveVoiceDidMapping(input.did))?.businessId, "business-b");
  assert.ok(state.docs.get(periodKey)?.endedAt);
  assert.equal(state.docs.get(`ai_did_recording_periods:${input.did}-3`)?.businessId, "business-b");
  assert.equal(state.docs.get(`ai_did_mappings:${input.did}`)?.forwardingExtension, null);
  assert.equal((await PUT(request("admin", { ...reassigned, version: 3, isActive: false }))).status, 200);
  assert.equal(await resolveVoiceDidMapping(input.did), null, "disabled dashboard entry cannot fall back to environment setup");
});

test("recording access follows historical DID ownership and playback grants are business-bound", async t => {
  const { listCallRecordings, recordingFileForGrant, fetchRecordingAudio } = await import("../lib/ai/calls/recordings");
  const cutoff = Math.floor(Date.now() / 1000) - 600;
  const config = { origin: "https://pbx.example.test", username: "test", secret: "test", trunks: ["Main"] };
  let downloadPath = "https://other.example.test/api/download/old.wav";
  const otherDid = "0359111404";
  const records = [
    { uid: "old", did_number: input.did, timestamp: cutoff - 120, record_file: "old.wav" },
    { uid: "crossing", did_number: input.did, timestamp: cutoff - 5, record_file: "crossing.wav" },
    { uid: "new", did_number: input.did, timestamp: cutoff + 120, record_file: "new.wav" },
    { uid: "other", did_number: otherDid, timestamp: cutoff + 120, record_file: "other.wav" },
  ].map(row => ({ ...row, call_type: "Inbound", src_trunk: "Main", duration: 30, call_from_number: "+61412345678" }));
  state.docs.set("customers:recording-caller-a", { registeredBusinessId: "business-a", phone: "0412 345 678", fullName: "Test Customer" });
  state.docs.set("customers:recording-caller-c", { registeredBusinessId: "business-c", phone: "0412345678", fullName: "Another Business Customer" });
  state.docs.set(`ai_did_recording_periods:${input.did}-1`, {
    did: input.did, businessId: "business-a", startedAt: Timestamp.fromMillis((cutoff - 600) * 1000),
    endedAt: Timestamp.fromMillis(cutoff * 1000),
  });
  state.docs.set(`ai_did_recording_periods:${input.did}-3`, {
    did: input.did, businessId: "business-b", startedAt: Timestamp.fromMillis(cutoff * 1000), endedAt: null,
  });
  const searchStarts: string[] = [];
  let tokenRequests = 0;
  t.mock.method(globalThis, "fetch", async (target: string | URL) => {
    const url = new URL(target);
    assert.equal(url.origin, config.origin);
    if (url.pathname.endsWith("/get_token")) {
      tokenRequests++;
      return Response.json({ errcode: 0, access_token: "test" });
    }
    if (url.pathname.endsWith("/recording/download")) {
      return Response.json({ errcode: 0, file: "old.wav", download_resource_url: downloadPath });
    }
    if (["/api/download/old.wav", "/api/downloadattachment/old.wav"].includes(url.pathname)) return new Response("audio");
    assert.equal(url.searchParams.get("did"), input.did + ":Main");
    assert.equal(url.searchParams.get("order_by"), "desc");
    searchStarts.push(url.searchParams.get("start_time") ?? "");
    return Response.json({ errcode: 0, data: records, total_number: records.length });
  });
  const [old, next] = await Promise.all([
    listCallRecordings(config, "business-a", 1),
    listCallRecordings(config, "business-b", 1),
  ]);
  assert.deepEqual(searchStarts.sort(), [String(cutoff - 600), String(cutoff)]);
  assert.deepEqual(old.recordings.map(record => record.id), ["old"]);
  assert.deepEqual(next.recordings.map(record => record.id), ["new"]);
  assert.equal(old.recordings[0].callerNumber, "+61412345678");
  assert.equal(old.recordings[0].customerName, "Test Customer");
  assert.equal(next.recordings[0].customerName, null);
  const filtered = await listCallRecordings(config, "business-a", 1, {
    start: (cutoff - 180) * 1000, end: (cutoff - 120) * 1000,
  });
  assert.deepEqual(filtered.recordings, [], "a call exactly at the exclusive end is outside the selected dates");
  const grant = old.recordings[0].grant;
  assert.equal(recordingFileForGrant(config, "business-a", grant), "old.wav");
  assert.equal(recordingFileForGrant(config, "business-b", grant), null);
  assert.equal(recordingFileForGrant(config, "business-a", grant + "x"), null);
  await assert.rejects(fetchRecordingAudio(config, "old.wav"), /Invalid PBX download URL/);
  downloadPath = "/api/download/old.wav";
  const audio = await fetchRecordingAudio(config, "old.wav");
  assert.equal(audio.headers.get("cache-control"), "private, no-store");
  assert.equal(await audio.text(), "audio");
  downloadPath = "/api/downloadattachment/old.wav";
  const attachment = await fetchRecordingAudio(config, "old.wav");
  assert.equal(attachment.headers.get("content-type"), "audio/wav");
  assert.equal(await attachment.text(), "audio");
  assert.equal(tokenRequests, 1, "listing and playback should share the PBX token");
});

test("only the business owner can opt in to Sophie voice features", async () => {
  const { PATCH } = await import("../app/api/business/sophie-permissions/route");
  const { POST } = await import("../app/api/business/live-calls/route");
  const { requireOwnerBriefing } = await import("../lib/ai/owner-call/auth");
  state.docs.set("businesses:sophie-permissions-business", { ownerUid: "owner-a", isActive: true });
  const ownerRequest = new Request("http://localhost", { headers: { Authorization: "Bearer owner-a" } });
  const grant = (uid: string, enabled: boolean) => PATCH(new Request("http://localhost", {
    method: "PATCH", headers: { Authorization: "Bearer " + uid }, body: JSON.stringify({ sophieTalkEnabled: enabled }),
  }));
  assert.equal((await requireOwnerBriefing(ownerRequest)).ok, false);
  assert.equal((await POST(ownerRequest)).status, 403);
  assert.equal((await grant("staff-a", true)).status, 403);
  assert.equal((await grant("another-owner", true)).status, 403);
  assert.equal((await grant("owner-a", true)).status, 200);
  assert.equal((await requireOwnerBriefing(ownerRequest)).ok, true);
  assert.equal((await POST(ownerRequest)).status, 403, "talk consent must not enable live listening");
  assert.equal((await grant("owner-a", false)).status, 200);
  assert.equal((await requireOwnerBriefing(ownerRequest)).ok, false);
});

test("live listening uses only a verified business call and its mapped extension", async t => {
  const { findLiveSophieCalls, startSophieListening } = await import("../lib/ai/calls/live-listen");
  const now = Math.floor(Date.now() / 1000);
  const id = `${now - 10}.1`;
  const config = { origin: "https://live-pbx.example.test", username: "test", secret: "test", trunks: ["Main"], bridgeExtension: "2000" };
  state.docs.set(`ai_did_recording_periods:${input.did}-7`, {
    did: input.did, businessId: "business-a", startedAt: Timestamp.fromMillis((now - 20) * 1000), endedAt: null,
  });
  state.docs.set(`ai_did_mappings:${input.did}`, { ...mapping, version: 7, recordingPeriodVersion: 7, forwardingExtension: "3101" });
  const members = [
    { inbound: { to: input.did, from: "0412345678", trunk_name: "Main", member_status: "ANSWERED" } },
    { extension: { number: "2000", channel_id: "PJSIP/2000-00000001", member_status: "ANSWER" } },
    { extension: { number: "3101", member_status: "RING" } },
  ];
  let submitted = 0;
  t.mock.method(globalThis, "fetch", async (target: string | URL, init?: RequestInit) => {
    const url = new URL(target);
    if (url.pathname.endsWith("/get_token")) return Response.json({ errcode: 0, access_token: "test" });
    if (url.pathname.endsWith("/call/listen")) {
      submitted++;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { monitor: "3101", channel_id: "PJSIP/2000-00000001", type: "listen" });
      return Response.json({ errcode: 0 });
    }
    if (url.searchParams.get("type") === "inbound") return Response.json({ errcode: 0, data: [] });
    assert.ok(url.searchParams.get("extension") === "2000" || url.searchParams.get("call_id") === id);
    return Response.json({ errcode: 0, data: [{ call_id: id, members }, { call_id: `${now - 30}.2`, members }] });
  });
  assert.deepEqual((await findLiveSophieCalls(config, "business-a")).map(call => call.id), [id]);
  assert.deepEqual(await findLiveSophieCalls(config, "business-b", id), []);
  const [call] = await findLiveSophieCalls(config, "business-a", id);
  await startSophieListening(config, call);
  assert.equal(submitted, 1);
  state.docs.set(`ai_did_mappings:${input.did}`, { ...mapping, version: 8, recordingPeriodVersion: 8, forwardingExtension: "3101" });
  assert.deepEqual(await findLiveSophieCalls(config, "business-a", id), []);
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
