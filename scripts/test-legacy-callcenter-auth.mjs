import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Load the actual routes and guards with isolated Firebase/provider boundaries.
// No credentials, network calls or real records are used.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const claims = { uid: "agent", email: "agent@example.test", role: "call_center" };
const agent = { isActive: true, name: "Agent", assignedBusinessIds: ["business-a"] };
const businesses = {
  "business-a": { businessName: "A", status: "active", isActive: true },
  "business-b": { businessName: "B", status: "active", isActive: true },
};
const reads = [];
const snapshot = (id, data) => ({ id, exists: Boolean(data), data: () => data });
const adminDb = {
  collection(collection) {
    const filters = [];
    const query = {
      doc(id) {
        return { async get() {
          if (collection === "call_center_agents") return snapshot(id, agent);
          if (collection === "businesses") return snapshot(id, businesses[id]);
          return snapshot(id, null);
        } };
      },
      where(field, operator, value) { filters.push({ field, value }); return query; },
      orderBy() { return query; },
      limit() { return query; },
      async get() {
        reads.push(collection);
        if (collection !== "businesses") return { docs: [] };
        let ids = Object.keys(businesses);
        for (const { field, value } of filters) {
          if (typeof field !== "string") ids = ids.filter((id) => value.includes(id));
        }
        return { docs: ids.map((id) => snapshot(id, businesses[id])) };
      },
    };
    return query;
  },
};
const mocks = {
  "server-only": {},
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/firebase/admin": { adminDb },
  "@/lib/audit/server": {},
  "@/lib/auth/account-access": { async verifyAccountIdToken(token) {
    if (token === "invalid") throw Error("Invalid token");
    return claims;
  } },
  "@/lib/quotations/server": { async listBusinessQuotations(id) {
    reads.push("quotations:" + id); return [];
  } },
  "@/lib/items/server": { async listCatalogItems(id) {
    reads.push("items:" + id); return [];
  } },
  "@/lib/onboarding/services/server": { async listBusinessServices(id) {
    reads.push("services:" + id); return { ok: true, services: [] };
  } },
};
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path);
  const exports = {};
  modules.set(path, exports);
  const source = ts.transpileModule(readFileSync(root + path + ".ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", source)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return load(name.slice(2));
    return require(name);
  }, exports);
  return exports;
}
function request(selector = "?businessId=business-a", token = "valid", header) {
  return new Request("https://example.test/api/callcenter/test" + selector, {
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(header ? { "x-tenant-id": header } : {}),
    },
  });
}

test("all legacy data routes enforce assignment before reading records", async () => {
  for (const route of ["quotations", "staff", "business-services", "services", "items"]) {
    const { GET } = load("app/api/callcenter/" + route + "/route");
    reads.length = 0;
    assert.equal((await GET(request("", null))).status, 401);
    assert.equal((await GET(request(undefined, "invalid"))).status, 401);
    for (const key of ["businessId", "tenantId", "ownerUid"]) {
      assert.equal((await GET(request("?" + key + "=business-b"))).status, 403);
    }
    assert.equal((await GET(request(undefined, "valid", "business-b"))).status, 403);
    agent.isActive = false;
    assert.equal((await GET(request())).status, 403);
    agent.isActive = true;
    claims.role = "customer";
    assert.equal((await GET(request())).status, 403);
    claims.role = "call_center";
    assert.deepEqual(reads, []);
    for (const key of ["businessId", "tenantId", "ownerUid"]) {
      assert.equal((await GET(request("?" + key + "=business-a"))).status, 200);
    }
    assert.equal((await GET(request("", "valid", "business-a"))).status, 200);
    claims.role = "super_admin";
    assert.equal((await GET(request("?businessId=business-b"))).status, 200);
    claims.role = "call_center";
    assert.equal((await GET(request("?businessId=business-b"))).status, 403);
  }
});

test("tenant enumeration returns assigned businesses and preserves super admin access", async () => {
  const { GET } = load("app/api/callcenter/tenants/route");
  const ids = async () => {
    const response = await GET(request(""));
    assert.equal(response.status, 200);
    return (await response.json()).tenants.map((tenant) => tenant.id).sort();
  };
  assert.deepEqual(await ids(), ["business-a"]);
  agent.assignedBusinessIds = [];
  assert.deepEqual(await ids(), []);
  agent.isActive = false;
  assert.equal((await GET(request(""))).status, 403);
  agent.isActive = true;
  claims.role = "super_admin";
  assert.deepEqual(await ids(), ["business-a", "business-b"]);
  claims.role = "call_center";
  agent.assignedBusinessIds = ["business-a"];
});
