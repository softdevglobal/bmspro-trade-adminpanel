import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
// @ts-expect-error The test runtime has module hooks. The app uses Node 20 typings.
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "trade-owner-voice-"));
const fixtures: Record<string, string> = {
  "lib/firebase/admin": `
    exports.adminDb = { collection: () => ({ doc: () => ({
      get: async () => ({ data: () => ({ ownerUid: "owner-a", isActive: true }) }),
    }) }) };
  `,
  "lib/onboarding/server": `
    exports.requireBusinessMember = async request => {
      const token = request.headers.get("authorization");
      if (!token) return { ok: false, status: 401, error: "Sign in." };
      return { ok: true, uid: token === "Bearer other-owner" ? "owner-b" : "owner-a",
        businessId: "business-a", role: token === "Bearer staff" ? "staff" : "owner" };
    };
  `,
  "lib/onboarding/business-status": `exports.isTenantAccessAllowed = () => true;`,
  "lib/security/rate-limit": `exports.consumeRateLimits = async () => true;`,
  "lib/ai/mcp/tools/owner-briefing.tools": `
    exports.ownerBriefingTools = businessId => ({ dailySummary: async offset => ({ businessId, offset }) });
  `,
};
const paths = new Map(Object.entries(fixtures).map(([key, source], index) => {
  const file = join(folder, `fixture-${index}.cjs`);
  writeFileSync(file, source);
  return [`@/${key}`, pathToFileURL(file).href];
}));
const hooks = registerHooks({
  resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
    const url = paths.get(specifier);
    return url ? { url, format: "commonjs", shortCircuit: true } : next(specifier, context);
  },
});
after(() => {
  hooks.deregister();
  rmSync(folder, { recursive: true, force: true });
});

test("browser voice starts only for the current owner and negotiates through the bridge", async (t) => {
  const { POST } = await import("../app/api/ai/owner-call/route");
  const secret = "trade-bridge-test-secret-0000000000000000";
  for (const [key, value] of Object.entries({
    AI_OWNER_VOICE_BRIDGE_URL: "http://127.0.0.1:18787",
    AI_VOICE_BRIDGE_SECRET: secret,
    OPENAI_API_KEY: undefined,
  })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const upstream = t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "http://127.0.0.1:18787/owner-voice/session");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${secret}`);
    assert.equal(init.redirect, "error");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.sdp, "v=0\r\nfixture");
    assert.match(payload.safetyIdentifier, /^[a-f0-9]{64}$/);
    assert.deepEqual(payload.session.tools.map((tool: { name: string }) => tool.name), [
      "get_daily_summary", "list_jobs_awaiting_scheduling", "get_staff_working_today",
    ]);
    return new Response("v=0\r\nanswer", { headers: { "Content-Type": "application/sdp" } });
  });
  const offer = (token?: string, body = "v=0\r\nfixture") => new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/sdp", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
  assert.equal((await POST(offer())).status, 401);
  assert.equal((await POST(offer("staff"))).status, 403);
  assert.equal((await POST(offer("other-owner"))).status, 403);
  assert.equal((await POST(offer("owner", "v=0\r\n" + "x".repeat(65536)))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
  const response = await POST(offer("owner"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "v=0\r\nanswer");
  assert.equal(upstream.mock.callCount(), 1);
  process.env.AI_OWNER_VOICE_BRIDGE_URL = "http://bridge.example.test";
  assert.equal((await POST(offer("owner"))).status, 503);
  assert.equal(upstream.mock.callCount(), 1);
});

test("briefing MCP reads only the authenticated owner's business", async () => {
  const { POST } = await import("../app/api/ai/owner-call/mcp/route");
  const request = (token: string) => new Request("http://localhost", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "get_daily_summary", arguments: { businessId: "business-b", offset: 2 },
    } }),
  });
  assert.equal((await POST(request("staff"))).status, 403);
  assert.equal((await POST(request("other-owner"))).status, 403);
  const response = await POST(request("owner"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(JSON.parse(payload.result.content[0].text), { businessId: "business-a", offset: 2 });
});
