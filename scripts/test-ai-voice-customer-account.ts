import assert from "node:assert/strict";
import test, { after } from "node:test";
// @ts-expect-error Node runtime supports hooks; repository uses Node 20 typings.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise real account provisioning with isolated Auth/Firestore/email boundaries.
const state = { existing: true, disabled: false, profile: null as Record<string, unknown> | null, writes: 0, emails: 0, authCreates: 0 };
(globalThis as typeof globalThis & { __voiceAccount: typeof state }).__voiceAccount = state;
const mocks: Record<string, string> = {
  "lib/firebase/admin": `const s=globalThis.__voiceAccount; exports.adminAuth={async getUserByEmail(){if(!s.existing)throw Object.assign(Error(),{code:'auth/user-not-found'});return {uid:'customer-a'};},async getUser(){return {disabled:s.disabled};},async createUser(){s.authCreates++;return {uid:'customer-a'};}}; exports.adminDb={collection(){return {doc(){return {async get(){return {exists:!!s.profile,data:()=>s.profile};},async set(value,options){s.writes++;s.profile=options?.merge?{...s.profile,...value}:value;},async create(value){if(s.profile)throw Error('exists');s.writes++;s.profile=value;}};}};}};`,
  "lib/auth/account-access": `exports.verifyAccountIdToken=async()=>{};`,
  "lib/auth/activation": `exports.inaccessibleInitialPassword=()=> 'random-unusable-password'; exports.issueActivationLink=async()=>{throw Error('Voice must defer activation');};`,
  "lib/email/templates": `exports.sendCustomerWelcomeEmail=async()=>{globalThis.__voiceAccount.emails++;return true;};`,
  "lib/audit/server": `exports.logAuditEvent=async()=>{};`,
};
const directory = mkdtempSync(join(tmpdir(), "trade-voice-account-"));
const paths = new Map<string, string>();
for (const [key, source] of Object.entries(mocks)) { const path = join(directory, `${key.replaceAll("/", "_")}.cjs`); writeFileSync(path, source); paths.set(key, path); }
after(() => { for (const path of paths.values()) unlinkSync(path); rmdirSync(directory); });
registerHooks({ resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
  const normalized = specifier.replaceAll("\\", "/");
  for (const [key, path] of paths) if (normalized === `@/${key}` || normalized.endsWith(`/${key}.ts`) || normalized.endsWith(`/${key}`)) return { url: pathToFileURL(path).href, format: "commonjs", shortCircuit: true };
  return next(specifier, context);
} });
test("voice account reuse does not edit profiles, activate accounts or send existing customers email", async () => {
  const { ensureCustomerAccount } = await import("../lib/customer/server");
  const input = { email: "test@example.test", fullName: "New Caller Name", phone: "0412345678", businessId: "business-a", bookingSlug: "test-business", preserveExistingProfile: true, sendWelcomeEmail: false };
  const original = { email: input.email, phone: input.phone, fullName: "Original Name", registeredBusinessId: "business-a" };
  state.profile = { ...original };
  assert.equal((await ensureCustomerAccount(input)).created, false);
  assert.deepEqual(state.profile, original); assert.equal(state.writes, 0); assert.equal(state.emails, 0);
  for (const profile of [null, { ...original, registeredBusinessId: "other" }, { ...original, phone: "0499999999" }]) {
    state.profile = profile; await assert.rejects(ensureCustomerAccount(input));
  }
  state.profile = original; state.disabled = true; await assert.rejects(ensureCustomerAccount(input)); state.disabled = false;
  assert.equal(state.writes, 0);
  state.existing = false; state.profile = null;
  assert.equal((await ensureCustomerAccount(input)).created, true);
  assert.equal(state.authCreates, 1); assert.equal(state.writes, 1); assert.equal(state.emails, 0);
  assert.equal(state.profile!.activationRequired, true); assert.equal(state.profile!.registeredBusinessId, "business-a");
});
