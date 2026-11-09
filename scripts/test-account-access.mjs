import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const profiles = { users: {}, customers: {}, businesses: {} };
let claims = { uid: "member", role: "staff", businessId: "a" };
const exports = {};
const source = ts.transpileModule(readFileSync(new URL("../lib/auth/account-access.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function("require", "exports", source)((name) => {
  if (name === "server-only") return {};
  assert.equal(name, "@/lib/firebase/admin");
  return {
    adminAuth: { async verifyIdToken(token, checkRevoked) {
      assert.equal(checkRevoked, true);
      if (token === "revoked") throw Error("Revoked session");
      return claims;
    } },
    adminDb: { collection(collection) { return { doc(id) { return { async get() {
      return { exists: Boolean(profiles[collection][id]), data: () => profiles[collection][id] };
    } }; } }; } },
  };
}, exports);
const { verifyAccountIdToken } = exports;
function reset() {
  claims = { uid: "member", role: "staff", businessId: "a" };
  profiles.users = { member: { role: "staff", businessId: "a" } };
  profiles.customers = {};
  profiles.businesses = { a: { status: "active", isActive: true } };
}

test("API verifier rejects all current account restrictions despite a cached token", async () => {
  for (const collection of ["users", "customers"]) {
    for (const patch of [
      { status: "inactive" }, { status: "disabled" }, { status: "suspended" },
      { disabled: true }, { suspended: true }, { isActive: false },
      { activationRequired: true }, { mustChangePassword: true }, { emailVerificationRequired: true },
    ]) {
      reset();
      profiles[collection].member = patch;
      await assert.rejects(verifyAccountIdToken("cached"));
    }
  }
});

test("API checks both token business and current user/customer business membership", async () => {
  for (const membership of ["token", "user", "customer"]) {
    for (const business of [undefined, { isActive: false }, { status: "suspended", isActive: true }]) {
      reset();
      claims = { uid: "member" };
      profiles.users = {};
      if (membership === "token") claims.businessId = "a";
      if (membership === "user") profiles.users.member = { businessId: "a" };
      if (membership === "customer") profiles.customers.member = { registeredBusinessId: "a" };
      profiles.businesses.a = business;
      await assert.rejects(verifyAccountIdToken("cached"));
    }
  }
});

test("active and reactivated members retain API access and revoked sessions fail", async () => {
  reset();
  assert.equal((await verifyAccountIdToken("cached")).uid, "member");
  profiles.businesses.a.status = "suspended";
  await assert.rejects(verifyAccountIdToken("cached"));
  profiles.businesses.a.status = "active";
  assert.equal((await verifyAccountIdToken("cached")).uid, "member");
  await assert.rejects(verifyAccountIdToken("revoked"));
  claims = { uid: "root", role: "super_admin" };
  assert.equal((await verifyAccountIdToken("admin")).uid, "root");
});
