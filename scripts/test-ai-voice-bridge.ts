import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { authenticateVoiceBridge, parseVoiceBusinesses } from "../lib/ai/config";
import { handleTradeVoiceMcp } from "../lib/ai/mcp/mcp-server";

const secret = "offline-trade-bridge-secret-0000000000000";
const env = { AI_VOICE_DIRECT_ENABLED: "true", AI_VOICE_BRIDGE_SECRET: secret };
const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/ai/mcp", {
  headers: { Authorization: `Bearer ${secret}`, "X-BMSPro-DID": "0359111403", ...headers },
});
const lookup = async (did: string) => did === "0359111403" ? { did, businessId: "business-a" } : null;

test("bridge authentication requires credentials, a saved DID and a matching call binding", async () => {
  const auth = await authenticateVoiceBridge(request(), env, lookup);
  assert.equal(auth.ok, true);
  if (auth.ok) assert.equal(auth.binding.businessId, "business-a");
  const invalidHeaders: Record<string, string>[] = [{ Authorization: "Bearer wrong" }, { "X-BMSPro-DID": "+0359111403" },
    { "X-BMSPro-DID": "0359111404" }, { "X-BMSPro-Trade-Business": "business-b" }];
  for (const headers of invalidHeaders) assert.equal((await authenticateVoiceBridge(request(headers), env, lookup)).ok, false);
  assert.equal((await authenticateVoiceBridge(request(), { ...env, AI_VOICE_DIRECT_ENABLED: "false" }, lookup)).ok, false);
  assert.equal((await authenticateVoiceBridge(request(), { ...env, AI_VOICE_BRIDGE_SECRET: "short" }, lookup)).ok, false);
  assert.throws(() => parseVoiceBusinesses('[{"did":"0359111403","businessId":"../b"}]'));
});

test("real MCP handshake exposes exactly profile/services and rejects all removed tools", async () => {
  const previousFlag = process.env.AI_VOICE_TRADE_REQUESTS_ENABLED;
  process.env.AI_VOICE_TRADE_REQUESTS_ENABLED = "true";
  let forbiddenCalls = 0;
  const reads = {
    profile: async () => ({ brand: "trade", did: "0359111403", businessId: "business-a", businessName: "Test Trade", timezone: "Australia/Melbourne" }),
    services: async () => [{ id: "service-a", name: "Electrical" }],
    submitInspection: async () => { forbiddenCalls++; return {}; },
  };
  const client = new Client({ name: "voice-bridge-test", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/api/ai/mcp"), {
      fetch: async (url, init) => handleTradeVoiceMcp(new Request(url, init), reads),
    }));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ["get_business_profile", "list_services"]);
    for (const name of ["get_business_profile", "list_services"]) assert.notEqual((await client.callTool({ name, arguments: {} })).isError, true);
    for (const name of ["get_available_slots", "create_inspection_request", "send_sms", "register_customer"]) {
      assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
    }
    assert.equal(forbiddenCalls, 0);
  } finally {
    await client.close();
    if (previousFlag === undefined) delete process.env.AI_VOICE_TRADE_REQUESTS_ENABLED;
    else process.env.AI_VOICE_TRADE_REQUESTS_ENABLED = previousFlag;
  }
});

test("tool outages return safe errors instead of fabricated business details", async () => {
  const response = await handleTradeVoiceMcp(new Request("http://localhost/api/ai/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_services", arguments: {} } }),
  }), { profile: async () => ({}), services: async () => { throw new Error("private database error"); } });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.result.isError, true);
  assert.equal(JSON.stringify(payload).includes("private database error"), false);
});
