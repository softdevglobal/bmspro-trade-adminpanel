import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
// @ts-expect-error Test runtime supports module hooks; app uses Node 20 typings.
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const fixture = { state: {} as Record<string, unknown>, optedOut: false, calls: [] as { id: string }[] };
(globalThis as typeof globalThis & { ownerCallNowFixture: typeof fixture }).ownerCallNowFixture = fixture;
const folder = mkdtempSync(join(tmpdir(), "owner-call-now-"));
const sources: Record<string, string> = {
  "lib/firebase/admin": `const f = globalThis.ownerCallNowFixture;
    exports.adminDb = { runTransaction: async fn => fn({
      get: async () => ({ get: key => f.state[key] }),
      set: (_, values) => Object.assign(f.state, values),
      update: (_, values) => Object.assign(f.state, values)
    }) };`,
  "lib/ai/calls/request-callback": `exports.requestSophieCallback = async input => {
    globalThis.ownerCallNowFixture.calls.push(input);
    return Response.json({ status: 'ANSWERED' });
  };`,
  "lib/ai/calls/callback-state": `exports.callbackState = () => ({});
    exports.callbackResultStatus = value => value;
    exports.resolveCallback = async () => {};
    exports.saveCallbackAttempt = async () => {};`,
  "lib/ai/data/call-logs": `exports.CALL_LOGS_COLLECTION = 'test_logs';`,
  "lib/ai/calls/callback-number": `exports.normalizeCallbackMobile = value => value;`,
  "lib/ai/calls/recordings": `exports.recordingConfig = () => ({});
    exports.verifyCallbackGrant = (_, businessId, grant) => grant === 'valid' ? {
      businessId, callerKey: '0412345678', number: '0412345678', did: '0359111403', startedAt: 1000
    } : null;`,
  "lib/ai/data/did-mappings": `exports.lookupVoiceDidRoute = async () => ({
    state: 'active', binding: { businessId: 'business-a' }
  });`,
  "lib/onboarding/services/server": `exports.requireBusinessOwner = async request =>
    request.headers.get('authorization') === 'Bearer owner'
      ? { ok: true, businessId: 'business-a' } : { ok: false, status: 403, error: 'Owner required' };`,
  "lib/security/rate-limit": `exports.consumeRateLimits = async () => true;`,
  "lib/ai/calls/call-preferences": `exports.isCustomerCallOptedOut = async () => globalThis.ownerCallNowFixture.optedOut;`,
};
const paths = new Map(Object.entries(sources).map(([name, source], i) => {
  const path = join(folder, `${i}.cjs`);
  writeFileSync(path, source);
  return [`@/${name}`, pathToFileURL(path).href];
}));
const hooks = registerHooks({ resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
  const url = paths.get(specifier);
  return url ? { url, format: "commonjs", shortCircuit: true } : next(specifier, context);
} });
after(() => { hooks.deregister(); rmSync(folder, { recursive: true, force: true }); });

test("explicit owner call ignores old resolution but preserves authorization, opt-out and active leases", async t => {
  const previousEnabled = process.env.AI_SOPHIE_CALLBACK_ENABLED;
  const previousSecret = process.env.AI_VOICE_BRIDGE_SECRET;
  process.env.AI_SOPHIE_CALLBACK_ENABLED = "true";
  process.env.AI_VOICE_BRIDGE_SECRET = "x".repeat(32);
  t.after(() => {
    if (previousEnabled === undefined) delete process.env.AI_SOPHIE_CALLBACK_ENABLED;
    else process.env.AI_SOPHIE_CALLBACK_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.AI_VOICE_BRIDGE_SECRET;
    else process.env.AI_VOICE_BRIDGE_SECRET = previousSecret;
  });
  const { POST } = await import("../app/api/business/sophie-callback/route");
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const request = (id?: string, owner = true, grant = "valid") => new Request("http://localhost/api/business/sophie-callback", {
    method: "POST", headers: { authorization: owner ? "Bearer owner" : "Bearer staff",
      "x-callback-grant": grant, ...(id ? { "x-owner-call-now": id } : {}) },
  });
  fixture.state = { through: 2000 };
  assert.equal((await POST(request())).status, 409);
  assert.equal((await POST(request(first))).status, 200);
  assert.equal((await POST(request(first))).status, 200);
  assert.equal(fixture.calls[0].id, fixture.calls[1].id, "HTTP retry keeps bridge idempotency key");
  assert.equal((await POST(request(second))).status, 200);
  assert.notEqual(fixture.calls[0].id, fixture.calls[2].id, "new instruction gets a fresh call ID");
  const count = fixture.calls.length;
  assert.equal((await POST(request(first, false))).status, 403);
  assert.equal((await POST(request(first, true, "wrong-tenant-grant"))).status, 404);
  assert.equal((await POST(request("invalid"))).status, 400);
  fixture.optedOut = true;
  assert.equal((await POST(request(first))).status, 409);
  fixture.optedOut = false;
  fixture.state.manualLeaseUntil = Date.now() + 60_000;
  assert.equal((await POST(request(first))).status, 409);
  assert.equal(fixture.calls.length, count, "blocked requests never reach the bridge");
});
