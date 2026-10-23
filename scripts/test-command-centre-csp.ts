import assert from "node:assert/strict";
import test from "node:test";
import { commandCentreBackendUrl } from "../lib/commandCentreBackendUrl";
import { contentSecurityPolicy } from "../lib/security/csp";

test("owner review uses production backend by default and keeps localhost for development", () => {
  assert.equal(commandCentreBackendUrl(undefined, false), "https://command-api.bmspros.com.au/api");
  assert.equal(commandCentreBackendUrl(undefined, true), "http://127.0.0.1:5050/api");
  assert.equal(commandCentreBackendUrl(" https://staging.example.test/api/ ", false), "https://staging.example.test/api");
  assert.throws(() => commandCentreBackendUrl("http://localhost:5050/api", false));
  assert.throws(() => commandCentreBackendUrl("https://user:password@example.test/api", false));
  assert.throws(() => commandCentreBackendUrl("https://example.test/api#connect-src *", false));
});

test("generated CSP permits the exact owner-review API origin for read and approval requests", () => {
  const policy = contentSecurityPolicy("test-nonce");
  assert.ok(policy);
  const allowed = policy.split(";").map(part => part.trim()).find(part => part.startsWith("connect-src "))!.split(/\s+/);
  const backend = commandCentreBackendUrl(process.env.NEXT_PUBLIC_COMMAND_CENTRE_BACKEND_URL, process.env.NODE_ENV === "development");
  assert.ok(allowed.includes(new URL(backend).origin));
  assert.equal(allowed.includes("*"), false);
  assert.ok(policy.includes("object-src 'none'"));
});
