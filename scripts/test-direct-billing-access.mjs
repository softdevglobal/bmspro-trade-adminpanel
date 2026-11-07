import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import ts from "typescript";

// Load the real route handlers and configuration with isolated billing boundaries.
const writes = [];
const balance = { limit: 100, used: 20 };
const subscription = { snapshot: { planId: "current" }, plans: [{ id: "current" }] };
const originalEnv = { NODE_ENV: process.env.NODE_ENV, STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY };
after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const mocks = {
  "server-only": {},
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/config/base-url": {},
  "@/lib/onboarding/services/server": { async requireBusinessOwner(request) {
    if (request.headers.get("authorization") === "Bearer owner") {
      return { ok: true, uid: "owner-a", businessId: "business-a" };
    }
    return { ok: false, status: 403, error: "Business owner access required." };
  } },
  "@/lib/sms-packages/server": {
    async getBusinessSmsBalance() { return balance; },
    async listSmsPackages() { return [{ id: "package-a" }]; },
    async purchaseSmsPackageForBusiness(...args) { writes.push(args); return balance; },
  },
  "@/lib/subscription-plans/tenant-subscription": {
    async listAvailablePlansForTenant() { return subscription; },
    async applyPlanChangeToTenant(...args) { writes.push(args); },
  },
};
function load(path) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, "Unexpected dependency " + name);
    return mocks[name];
  }, exports);
  return exports;
}
mocks["@/lib/stripe/config"] = load("lib/stripe/config.ts");
const routes = [load("app/api/business/sms/route.ts"), load("app/api/business/subscription/route.ts")];
function request(token = "owner", body = { packageId: "package-a", planId: "premium" }) {
  return new Request("https://example.test/api/business/billing", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("production without Stripe rejects direct changes with 503 and zero writes", async () => {
  process.env.NODE_ENV = "production";
  for (const key of [undefined, "", "   "]) {
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = key;
    for (const { POST } of routes) {
      const response = await POST(request());
      assert.equal(response.status, 503);
      assert.equal((await response.json()).ok, false);
    }
  }
  assert.deepEqual(writes, []);
});

test("configured or malformed keys never enable direct plan changes or SMS grants", async () => {
  process.env.NODE_ENV = "production";
  for (const key of ["invalid-key", "sk_test_fixture", "sk_live_fixture"]) {
    process.env.STRIPE_SECRET_KEY = key;
    for (const { POST } of routes) assert.equal((await POST(request())).status, 403);
  }
  assert.deepEqual(writes, []);
});

test("development and test environments cannot enable a payment bypass", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  for (const mode of ["development", "test"]) {
    process.env.NODE_ENV = mode;
    for (const { POST } of routes) assert.equal((await POST(request())).status, 503);
  }
  assert.deepEqual(writes, []);
});

test("replays and unauthorized roles cannot mutate billing", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.STRIPE_SECRET_KEY;
  for (const { POST } of routes) {
    for (const token of ["customer", "staff", "onboarding", "invalid"]) {
      assert.equal((await POST(request(token))).status, 403);
    }
    const responses = await Promise.all(Array.from({ length: 10 }, () => POST(request())));
    assert.ok(responses.every((response) => response.status === 503));
  }
  assert.deepEqual(writes, []);
});

test("owners can still read balances, package catalogs and subscriptions", async () => {
  const sms = await routes[0].GET(request());
  assert.equal(sms.status, 200);
  assert.deepEqual(await sms.json(), { ok: true, balance, packages: [{ id: "package-a" }] });
  const plans = await routes[1].GET(request());
  assert.equal(plans.status, 200);
  assert.deepEqual(await plans.json(), { ok: true, subscription: subscription.snapshot, plans: subscription.plans, stripeEnabled: false });
  assert.deepEqual(writes, []);
});
