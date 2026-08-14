/**
 * Server-side access-control tests for the HTTP API.
 *
 * Run with `npm run test:api`, which starts the Auth and Firestore emulators and
 * executes this file. It builds nothing: run `npm run build` first.
 *
 * Unlike the rules tests (scripts/test-firestore-rules.mjs), these drive the real
 * Next server over HTTP with real Firebase ID tokens, so they cover the layer the
 * rules cannot: whether route handlers check the caller's role and confine every
 * lookup to the caller's tenant.
 *
 * Three question are asked of each endpoint:
 *   unauthorized  — no token at all
 *   wrong role    — a valid token for an account that should not have access
 *   cross tenant  — a valid token for the wrong tenant's data
 *
 * Credentials are synthetic: a throwaway RSA key is generated per run and the
 * emulator accepts tokens signed with it, so no real service account is needed.
 */
import { spawn } from "node:child_process";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "bms-api-test";
const AUTH_EMULATOR = "127.0.0.1:9099";
const FIRESTORE_EMULATOR = "127.0.0.1:8080";
const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const BUSINESS_A = "biz-a";
const BUSINESS_B = "biz-b";

if (!existsSync(new URL("../.next/BUILD_ID", import.meta.url))) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

// ---------------------------------------------------------------- credentials
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const CLIENT_EMAIL = `test@${PROJECT_ID}.iam.gserviceaccount.com`;

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR;

const app = initializeApp({
  credential: cert({ projectId: PROJECT_ID, clientEmail: CLIENT_EMAIL, privateKey }),
  projectId: PROJECT_ID,
});
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);

// ------------------------------------------------------------------- fixtures
async function seed() {
  for (const [businessId, ownerUid] of [
    [BUSINESS_A, "owner-a"],
    [BUSINESS_B, "owner-b"],
  ]) {
    await adminDb.collection("businesses").doc(businessId).set({
      businessId,
      businessName: `Business ${businessId}`,
      ownerUid,
      isActive: true,
      status: "active",
      createdAt: new Date(),
    });
  }

  const fixtures = [
    [BUSINESS_A, "a"],
    [BUSINESS_B, "b"],
  ];
  for (const [businessId, suffix] of fixtures) {
    // Collection name matters: a typo here would make the cross-tenant job test
    // pass vacuously, since a missing document also answers 404.
    await adminDb.collection("jobs").doc(`job-${suffix}`).set({
      businessId,
      status: "scheduled",
      customer: { fullName: "Test", email: `customer-${suffix}@example.com` },
      createdAt: new Date(),
    });
    await adminDb.collection("invoices").doc(`invoice-${suffix}`).set({
      businessId,
      invoiceCode: `INV-${suffix.toUpperCase()}`,
      status: "draft",
      createdAt: new Date(),
    });
    await adminDb.collection("items").doc(`item-${suffix}`).set({
      businessId,
      name: `Item ${suffix}`,
      createdAt: new Date(),
    });
    await adminDb.collection("audit_logs").add({
      businessId,
      businessName: `Business ${businessId}`,
      category: "invoice",
      action: "invoice.created",
      actorUid: `owner-${suffix}`,
      actorRole: "owner",
      source: "admin_panel",
      summary: `secret-${suffix}`,
      createdAt: new Date(),
    });
  }

  await adminDb.collection("super_admins").doc("root").set({ isActive: true });
}

/** Creates an emulator user with claims and returns a usable ID token. */
async function tokenFor(uid, claims) {
  try {
    await adminAuth.createUser({ uid, email: `${uid}@example.com`, password: "test1234" });
  } catch (error) {
    if (error.code !== "auth/uid-already-exists") throw error;
  }
  await adminAuth.setCustomUserClaims(uid, claims);

  const customToken = await adminAuth.createCustomToken(uid, claims);
  const response = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await response.json();
  if (!data.idToken) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.idToken;
}

// --------------------------------------------------------------- server start
function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      FIREBASE_ADMIN_PROJECT_ID: PROJECT_ID,
      FIREBASE_ADMIN_CLIENT_EMAIL: CLIENT_EMAIL,
      FIREBASE_ADMIN_PRIVATE_KEY: privateKey,
      FIREBASE_ADMIN_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
      FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR,
      FIRESTORE_EMULATOR_HOST: FIRESTORE_EMULATOR,
      // Two destinations sign with different secrets; the route must accept both.
      STRIPE_SECRET_KEY: "sk_test_harness",
      STRIPE_WEBHOOK_SECRET: "whsec_platform_secret, whsec_connected_secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  return { child, logs };
}

async function waitForServer(logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/tenants`);
      if (response.status > 0) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Server did not start.\n${logs.join("")}`);
}

// ----------------------------------------------------------------- assertions
let passed = 0;
let failed = 0;
const failures = [];

async function expectStatus(name, expected, requestInit) {
  const { path, token, method = "GET", body } = requestInit;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  let actual;
  let detail = "";
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    actual = response.status;
    if (actual !== expected) detail = (await response.text()).slice(0, 160);
  } catch (error) {
    actual = `error: ${error.message}`;
  }

  const wanted = Array.isArray(expected) ? expected : [expected];
  if (wanted.includes(actual)) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}\n        expected ${wanted.join(" or ")}, got ${actual} ${detail}`);
  }
}

async function expectBodyExcludes(name, { path, token, forbidden }) {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    if (response.ok && !text.includes(forbidden)) {
      passed += 1;
      console.log(`  PASS  ${name}`);
      return;
    }
    failed += 1;
    failures.push(name);
    console.log(
      `  FAIL  ${name}\n        status ${response.status}, leaked=${text.includes(forbidden)}`,
    );
  } catch (error) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

// ----------------------------------------------------------------------- main
const { child, logs } = startServer();
try {
  await seed();
  await waitForServer(logs);

  const superAdmin = await tokenFor("root", { role: "super_admin", superAdmin: true });
  const ownerA = await tokenFor("owner-a", { role: "owner", businessId: BUSINESS_A });
  const ownerB = await tokenFor("owner-b", { role: "owner", businessId: BUSINESS_B });
  const staffA = await tokenFor("staff-a", { role: "staff", businessId: BUSINESS_A });
  const agent = await tokenFor("agent-1", { role: "call_center" });
  const customer = await tokenFor("customer-1", {});

  const ADMIN_ENDPOINTS = [
    "/api/admin/tenants",
    "/api/admin/tenants/list",
    "/api/admin/service-templates",
    "/api/admin/broadcasts",
    "/api/admin/audit-logs",
  ];

  console.log("\nunauthorized — no credentials");
  for (const path of ADMIN_ENDPOINTS) {
    await expectStatus(`401 for anonymous ${path}`, 401, { path });
  }
  await expectStatus("401 for anonymous /api/items", 401, { path: "/api/items" });
  await expectStatus("401 for anonymous /api/invoices", 401, { path: "/api/invoices" });
  await expectStatus("401 for a forged token", 401, {
    path: "/api/admin/tenants",
    token: "not-a-real-token",
  });

  console.log("\nwrong role — authenticated, but not a platform admin");
  for (const [label, token] of [
    ["business owner", ownerA],
    ["staff", staffA],
    ["call-centre agent", agent],
    ["customer", customer],
  ]) {
    for (const path of ADMIN_ENDPOINTS) {
      await expectStatus(`403 for ${label} on ${path}`, 403, { path, token });
    }
  }
  await expectStatus("403 for business owner creating a tenant", 403, {
    path: "/api/admin/tenants/create",
    token: ownerA,
    method: "POST",
    body: { businessName: "Hostile", email: "x@example.com" },
  });
  await expectStatus("403 for business owner suspending a tenant", 403, {
    path: `/api/admin/tenants/${BUSINESS_B}/status`,
    token: ownerA,
    method: "PATCH",
    body: { status: "suspended" },
  });
  await expectStatus("403 for staff changing tenant modules", 403, {
    path: `/api/admin/tenants/${BUSINESS_A}/modules`,
    token: staffA,
    method: "PATCH",
    body: { enabledModules: { invoices: false } },
  });
  await expectStatus("403 for business owner publishing a service template", 403, {
    path: "/api/admin/service-templates",
    token: ownerA,
    method: "POST",
    body: { name: "Hostile template" },
  });

  console.log("\nsuper admin retains access");
  for (const path of ADMIN_ENDPOINTS) {
    await expectStatus(`200 for super admin on ${path}`, 200, { path, token: superAdmin });
  }

  console.log("\ncross tenant — valid token, another tenant's data");
  await expectStatus("owner B cannot read tenant A's job", [403, 404], {
    path: "/api/jobs/job-a",
    token: ownerB,
  });
  await expectStatus("owner B cannot delete tenant A's invoice", [403, 404], {
    path: "/api/invoices/invoice-a",
    token: ownerB,
    method: "DELETE",
  });
  await expectStatus("owner A reads its own job", 200, {
    path: "/api/jobs/job-a",
    token: ownerA,
  });
  await expectBodyExcludes("owner B's item list excludes tenant A's items", {
    path: "/api/items",
    token: ownerB,
    forbidden: "Item a",
  });
  await expectBodyExcludes("owner B's invoice list excludes tenant A's invoices", {
    path: "/api/invoices",
    token: ownerB,
    forbidden: "INV-A",
  });

  console.log("\ncross tenant — supplying another tenant's id as a parameter");
  await expectBodyExcludes("businessId query cannot widen an owner's audit scope", {
    path: `/api/audit-logs?businessId=${BUSINESS_A}`,
    token: ownerB,
    forbidden: "secret-a",
  });
  await expectStatus("owner B cannot suspend tenant A through the admin route", 403, {
    path: `/api/admin/tenants/${BUSINESS_A}/status`,
    token: ownerB,
    method: "PATCH",
    body: { status: "suspended" },
  });

  console.log("\npassword reset — throttling, enumeration, single use");
  const sendResetCode = (email) =>
    fetch(`${BASE_URL}/api/auth/send-reset-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

  const KNOWN = "owner-a@example.com";
  const UNKNOWN = "nobody-here@example.com";

  const firstKnown = await sendResetCode(KNOWN);
  const firstUnknown = await sendResetCode(UNKNOWN);
  const firstKnownBody = await firstKnown.text();
  const firstUnknownBody = await firstUnknown.text();
  if (
    firstKnown.status === firstUnknown.status &&
    firstKnownBody === firstUnknownBody
  ) {
    passed += 1;
    console.log("  PASS  first request is identical for known and unknown addresses");
  } else {
    failed += 1;
    failures.push("first request is identical for known and unknown addresses");
    console.log(
      `  FAIL  first request is identical for known and unknown addresses\n        known=${firstKnown.status} ${firstKnownBody} unknown=${firstUnknown.status} ${firstUnknownBody}`,
    );
  }

  // The throttle is the part that used to leak: it only existed for addresses
  // with an account, so a 429 on the second try confirmed the address.
  const secondKnown = await sendResetCode(KNOWN);
  const secondUnknown = await sendResetCode(UNKNOWN);
  const secondKnownBody = await secondKnown.text();
  const secondUnknownBody = await secondUnknown.text();
  if (
    secondKnown.status === 429 &&
    secondUnknown.status === 429 &&
    secondKnownBody === secondUnknownBody
  ) {
    passed += 1;
    console.log("  PASS  throttled request is identical for known and unknown addresses");
  } else {
    failed += 1;
    failures.push("throttled request is identical for known and unknown addresses");
    console.log(
      `  FAIL  throttled request is identical for known and unknown addresses\n        known=${secondKnown.status} ${secondKnownBody} unknown=${secondUnknown.status} ${secondUnknownBody}`,
    );
  }

  const codeSnap = await adminDb.collection("passwordResetCodes").doc(KNOWN).get();
  const issuedCode = codeSnap.data()?.code;
  if (typeof issuedCode === "string" && /^\d{6}$/.test(issuedCode)) {
    passed += 1;
    console.log("  PASS  a six-digit code is issued for a real account");
  } else {
    failed += 1;
    failures.push("a six-digit code is issued for a real account");
    console.log(`  FAIL  a six-digit code is issued for a real account\n        got ${issuedCode}`);
  }

  const noCodeForUnknown = await adminDb
    .collection("passwordResetCodes")
    .doc(UNKNOWN)
    .get();
  await expectStatus("wrong code is rejected", 400, {
    path: "/api/auth/reset-password",
    method: "POST",
    body: { email: KNOWN, code: "000000", newPassword: "brand-new-pass" },
  });
  await expectStatus("correct code resets the password", 200, {
    path: "/api/auth/reset-password",
    method: "POST",
    body: { email: KNOWN, code: issuedCode, newPassword: "brand-new-pass" },
  });
  await expectStatus("the same code cannot be reused", 400, {
    path: "/api/auth/reset-password",
    method: "POST",
    body: { email: KNOWN, code: issuedCode, newPassword: "another-new-pass" },
  });

  if (!noCodeForUnknown.exists) {
    passed += 1;
    console.log("  PASS  no reset code is stored for an unknown address");
  } else {
    failed += 1;
    failures.push("no reset code is stored for an unknown address");
    console.log("  FAIL  no reset code is stored for an unknown address");
  }

  console.log("\nstripe webhook accepts every configured destination secret");
  // Two event destinations (platform + connected accounts) point at this one
  // route, each signing with its own secret. Sign the payload the way Stripe
  // does so the route's verification is exercised for real.
  const signedRequest = async (secret) => {
    const payload = JSON.stringify({
      id: "evt_test",
      object: "event",
      type: "ping.unhandled",
      data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return fetch(`${BASE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    });
  };

  for (const [label, secret, expected] of [
    ["platform destination secret", "whsec_platform_secret", 200],
    ["connected-accounts destination secret", "whsec_connected_secret", 200],
    ["an unknown secret", "whsec_not_configured", 400],
  ]) {
    const response = await signedRequest(secret);
    if (response.status === expected) {
      passed += 1;
      console.log(`  PASS  ${label} -> ${expected}`);
    } else {
      failed += 1;
      failures.push(`${label} -> ${expected}`);
      console.log(`  FAIL  ${label} -> expected ${expected}, got ${response.status}`);
    }
  }

  const unsigned = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (unsigned.status === 400) {
    passed += 1;
    console.log("  PASS  unsigned delivery -> 400");
  } else {
    failed += 1;
    failures.push("unsigned delivery -> 400");
    console.log(`  FAIL  unsigned delivery -> expected 400, got ${unsigned.status}`);
  }

  console.log("\nadmin actions are recorded in the audit log");
  await fetch(`${BASE_URL}/api/admin/tenants/${BUSINESS_A}/modules`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${superAdmin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabledModules: { invoices: false } }),
  });
  const moduleEntries = await adminDb
    .collection("audit_logs")
    .where("action", "==", "tenant.modules_updated")
    .get();
  const moduleEntry = moduleEntries.docs[0]?.data();
  if (moduleEntry?.actorUid === "root" && moduleEntry?.businessId === BUSINESS_A) {
    passed += 1;
    console.log("  PASS  module changes write an attributed audit entry");
  } else {
    failed += 1;
    failures.push("module changes write an attributed audit entry");
    console.log(
      `  FAIL  module changes write an attributed audit entry\n        entry=${JSON.stringify(moduleEntry ?? null)}`,
    );
  }

  const before = (await adminDb.collection("audit_logs").get()).size;
  await fetch(`${BASE_URL}/api/admin/tenants/${BUSINESS_A}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${superAdmin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "suspended" }),
  });
  const after = (await adminDb.collection("audit_logs").get()).size;
  const logged = await adminDb
    .collection("audit_logs")
    .where("action", "==", "tenant.suspended")
    .get();
  const entry = logged.docs[0]?.data();
  if (after > before && entry?.actorUid === "root" && entry?.actorRole === "super_admin") {
    passed += 1;
    console.log("  PASS  tenant suspension writes an attributed audit entry");
  } else {
    failed += 1;
    failures.push("tenant suspension writes an attributed audit entry");
    console.log(
      `  FAIL  tenant suspension writes an attributed audit entry\n        before=${before} after=${after} entry=${JSON.stringify(entry ?? null)}`,
    );
  }
} finally {
  child.kill("SIGTERM");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nFailing cases:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
console.log("");
process.exit(0);
