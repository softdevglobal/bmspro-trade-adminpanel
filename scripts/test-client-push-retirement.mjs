import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual handler with fixture tokens. Any Firebase or push access
// fails the test before credentials, records or messaging services can be used.
const source = readFileSync(new URL("../app/api/notifications/send-push/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
const sessions = new Map([
  ["customer", { uid: "customer-a", role: "customer", businessId: "a" }],
  ["onboarding", { uid: "onboarding", onboardingOnly: true }],
  ["staff", { uid: "staff-a", role: "staff", businessId: "a" }],
  ["owner", { uid: "owner-a", role: "owner", businessId: "a" }],
  ["super-admin", { uid: "admin", role: "super_admin" }],
]);
const sideEffects = [];
new Function("require", "exports", compiled)((name) => {
  if (name === "next/server") {
    return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  }
  if (name === "@/lib/auth/account-access") {
    return { async verifyAccountIdToken(token) {
      if (!sessions.has(token)) throw Error("Invalid or revoked token");
      return sessions.get(token);
    } };
  }
  if (name === "@/lib/notifications/push") {
    return { async sendStaffMobilePush(input) { sideEffects.push(input); } };
  }
  throw Error("Unexpected dependency in retired push handler: " + name);
}, exports);
const { POST } = exports;

function request(token, body) {
  return new Request("https://example.test/api/notifications/send-push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("missing and invalid sessions receive 401 without sending notifications", async () => {
  for (const token of [null, "invalid", "revoked"]) {
    assert.equal((await POST(request(token, {}))).status, 401);
  }
  assert.deepEqual(sideEffects, []);
});

test("all roles are denied client-controlled notifications to own or other tenants", async () => {
  for (const token of sessions.keys()) {
    for (const targetUid of ["staff-a", "staff-b"]) {
      const response = await POST(request(token, {
        targetUid, title: "Forged owner alert", message: "Untrusted message",
        data: { businessId: "b", route: "/admin", type: "booking_assigned" },
      }));
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "CLIENT_PUSH_RETIRED",
        error: "Direct push requests are no longer supported.",
      });
    }
  }
  assert.deepEqual(sideEffects, []);
});

test("legacy field aliases and malformed payloads cannot restore push sending", async () => {
  for (const body of [
    { staffUid: "staff-b", title: "Title", body: "Message" },
    null, [], {}, "{invalid-json",
  ]) {
    assert.equal((await POST(request("staff", body))).status, 410);
  }
  assert.deepEqual(sideEffects, []);
});

test("concurrent replays send no notifications", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => POST(request("owner", {
    targetUid: "staff-b", title: "Replay", message: "Replay", data: { eventId: "same-event" },
  }))));
  assert.ok(results.every((response) => response.status === 410));
  assert.deepEqual(sideEffects, []);
});
