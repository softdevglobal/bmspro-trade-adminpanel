import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Security tests require isolated Auth and Firestore emulators.");
}
const projectId = "demo-bms-security-test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const app = initializeApp({ projectId, credential: cert({ projectId, clientEmail: `test@${projectId}.iam.gserviceaccount.com`, privateKey }) });
const adminAuth = getAuth(app); const adminDb = getFirestore(app);
const sessions = new Map();
globalThis.__tradeSecurityTest = { adminApp: app, adminAuth, adminDb, sessions };
process.env.APP_URL = "http://localhost:3210";
const testDirectory = new URL("../tmp/security-tests/", import.meta.url);
mkdirSync(testDirectory, { recursive: true });
const bundle = new URL("security.cjs", testDirectory);
await build({ stdin: { contents: `export * from "@/lib/auth/account-access";
export * from "@/lib/auth/activation"; export * from "@/lib/auth/reset-codes";
export * from "@/lib/security/rate-limit"; export * from "@/lib/security/file-types";
export * from "@/lib/chat/ccDirectChat"; export * from "@/lib/callcenter/auth";
export * from "@/lib/stripe/payment-fulfillment"; export * from "@/lib/stripe/payments";
export * from "@/lib/payments/checkout-record"; export * from "@/lib/export/tabular";
export * from "@/lib/security/upload-request";`, resolveDir: process.cwd(), loader: "ts" },
  outfile: fileURLToPath(bundle), bundle: true, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "isolated-security-fixtures", setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/firebase\/admin$/ }, () => ({ path: "admin", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/stripe\/client$/ }, () => ({ path: "stripe", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/stripe\/connect$/ }, () => ({ path: "connect", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/invoices\/server$/ }, () => ({ path: "invoices", namespace: "fixture" }));
    builder.onResolve({ filter: /^@\/lib\/payments\/public$/ }, () => ({ path: "public-payment", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: ({
      empty: "", admin: "export const {adminApp,adminAuth,adminDb}=globalThis.__tradeSecurityTest; export const adminStorage={}; export function getStorageBucketName(){return 'test-bucket';}",
      stripe: "export function getStripe(){return {checkout:{sessions:{retrieve:async (id)=>globalThis.__tradeSecurityTest.sessions.get(id),create:async (params,options)=>globalThis.__tradeSecurityTest.createSession(params,options)}}};}",
      connect: "export async function getBusinessConnectAccount(id){const data=(await globalThis.__tradeSecurityTest.adminDb.collection('businesses').doc(id).get()).data();return {accountId:data?.stripeConnectAccountId,onboarded:true};}",
      invoices: "export async function syncSettledInvoice(){} export async function getBusinessInvoiceByQuotationId(){return null;}",
      "public-payment": "export async function getPublicPaymentContext(){return globalThis.__tradeSecurityTest.checkoutContext;}",
    })[path], loader: "js" }));
  } }] });
const imported = await import(bundle.href);
const security = imported.default;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const uid = "pending-owner"; const email = "pending@example.test";
await adminAuth.createUser({ uid, email, password: "initial-password", emailVerified: false });
await adminAuth.setCustomUserClaims(uid, { role: "pending_owner", businessId: "biz-a" });
await adminDb.collection("users").doc(uid).set({ role: "owner", businessId: "biz-a", activationRequired: true, mustChangePassword: true });
await adminDb.collection("businesses").doc("biz-a").set({ ownerUid: uid, emailVerificationPending: true, isActive: false, stripeConnectAccountId: "acct_a" });
const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "initial-password", returnSecureToken: true }),
});
const { idToken } = await response.json();
await check("pending owner cannot use direct API token", () => assert.rejects(security.verifyAccountIdToken(idToken)));
await check("activation links are single-use under concurrency", async () => {
  const link = await security.issueActivationLink(uid, "owner"); const token = link.split("/").at(-1);
  const results = await Promise.allSettled([security.activateAccount(token, "secure-password-one"), security.activateAccount(token, "secure-password-two")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await adminAuth.getUser(uid)).emailVerified, true);
  assert.equal((await adminDb.collection("users").doc(uid).get()).data().activationRequired, false);
  assert.equal((await adminDb.collection("businesses").doc("biz-a").get()).data().isActive, true);
});
await check("new invitation invalidates the previous link", async () => {
  const first = await security.issueActivationLink(uid, "owner");
  await security.issueActivationLink(uid, "owner");
  await assert.rejects(security.activateAccount(first.split("/").at(-1), "secure-password-three"));
});
const resetRef = adminDb.collection("passwordResetCodes").doc("concurrency@example.test");
async function resetFixture() { await resetRef.set({ codeDigest: security.resetCodeDigest("123456"), expiresAt: Timestamp.fromMillis(Date.now() + 120_000), used: false, attempts: 0 }); }
await check("six concurrent incorrect OTPs stop at five attempts", async () => {
  await resetFixture(); const attempts = await Promise.all(Array.from({ length: 6 }, () => security.consumeResetCode(resetRef, "654321")));
  assert.equal(attempts.filter(Boolean).length, 0); assert.equal((await resetRef.get()).data().attempts, 5);
  assert.equal(await security.consumeResetCode(resetRef, "123456"), false);
});
await check("only one concurrent correct OTP succeeds", async () => {
  await resetFixture(); const results = await Promise.all([security.consumeResetCode(resetRef, "123456"), security.consumeResetCode(resetRef, "123456")]);
  assert.equal(results.filter(Boolean).length, 1);
});
await check("rate limits reserve atomically", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => security.consumeRateLimits([{ key: "concurrent", limit: 3, windowMs: 60_000 }])));
  assert.equal(results.filter(Boolean).length, 3);
});
await adminDb.collection("users").doc("staff-a").set({ role: "staff", businessId: "biz-a" });
await adminDb.collection("cc_direct_chats").doc("room-a").set({ tenantUserUid: "staff-a", participantIds: ["staff-a", "agent-a"] });
await adminDb.collection("cc_direct_chats").doc("room-a").collection("messages").doc("message").set({ text: "tenant A only", createdAt: Timestamp.now() });
await check("known room ID does not grant other tenants chat access", async () => {
  assert.deepEqual(await security.getCcMessages("room-a", { uid: "staff-b", businessId: "biz-b" }), []);
  assert.deepEqual(await security.getCcMessages("room-a", { uid: "staff-a", businessId: "biz-b" }), []);
  assert.equal((await security.getCcMessages("room-a", { uid: "staff-a", businessId: "biz-a" })).length, 1);
});
await check("inactive call-center profile overrides active token claim", async () => {
  const agentUid = "inactive-agent";
  await adminAuth.createUser({ uid: agentUid, email: "agent@example.test", password: "test-password" });
  await adminAuth.setCustomUserClaims(agentUid, { role: "call_center" });
  await adminDb.collection("users").doc(agentUid).set({ role: "call_center", isActive: true });
  await adminDb.collection("call_center_agents").doc(agentUid).set({ isActive: false });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "agent@example.test", password: "test-password", returnSecureToken: true }),
  });
  const { idToken } = await response.json();
  const result = await security.requireCallCenterAgent(new Request("http://test/api", { headers: { Authorization: `Bearer ${idToken}` } }));
  assert.equal(result.ok, false); assert.equal(result.status, 403);
});
function paymentFixture(sessionId, targetId = "invoice-a", type = "invoice_payment") {
  const record = { businessId: "biz-a", targetId, paymentType: type, accountId: "acct_a", baseCents: 10000,
    feeCents: 0, totalCents: 10000, currency: "aud", feePayerMode: "business", reservationId: sessionId, sessionId,
    token: "test", reference: "test", expiresAt: Math.floor(Date.now() / 1000 + 1800) * 1000 };
  const session = { id: sessionId, mode: "payment", status: "complete", payment_status: "paid", amount_total: 10000, currency: "aud", expires_at: record.expiresAt / 1000,
    metadata: { businessId: record.businessId, targetId, paymentType: type, reservationId: sessionId },
    payment_intent: { id: `pi_${sessionId}`, status: "succeeded", amount_received: 10000, currency: "aud" } };
  sessions.set(sessionId, session); return { record, session };
}
await check("concurrent checkout creation reuses one authorized Stripe session", async () => {
  globalThis.__tradeSecurityTest.checkoutContext = { businessId: "biz-a", targetId: "checkout-invoice", type: "invoice", token: "checkout-token", reference: "INV-TEST", title: "Invoice", canPay: true, alreadyPaid: false,
    amounts: { baseCents: 10000, feeCents: 0, totalCents: 10000, currency: "aud", feePayerMode: "business" } };
  const created = new Map();
  globalThis.__tradeSecurityTest.createSession = async (params, options) => {
    if (!created.has(options.idempotencyKey)) created.set(options.idempotencyKey, { id: "cs_created", url: "https://checkout.stripe.com/test", expires_at: params.expires_at });
    return created.get(options.idempotencyKey);
  };
  const results = await Promise.all([security.createPaymentCheckoutSession("checkout-token"), security.createPaymentCheckoutSession("checkout-token")]);
  assert.ok(results.every((result) => result.ok && result.sessionId === "cs_created"));
  assert.equal(created.size, 1);
  assert.equal((await adminDb.collection("payment_checkout_sessions").doc("cs_created").get()).data().baseCents, 10000);
});
await check("checkout reuse rejects changed amounts or connected accounts", async () => {
  const context = globalThis.__tradeSecurityTest.checkoutContext;
  context.amounts.baseCents = 9000;
  assert.equal((await security.createPaymentCheckoutSession("checkout-token")).status, 409);
  context.amounts.baseCents = 10000;
  await adminDb.collection("businesses").doc("biz-a").update({ stripeConnectAccountId: "acct_other" });
  assert.equal((await security.createPaymentCheckoutSession("checkout-token")).status, 409);
  await adminDb.collection("businesses").doc("biz-a").update({ stripeConnectAccountId: "acct_a" });
});
await adminDb.collection("invoices").doc("invoice-a").set({ businessId: "biz-a", status: "sent", balanceDueAud: 100, amountPaidAud: 0 });
const first = paymentFixture("cs_first"); const second = paymentFixture("cs_second");
await adminDb.collection("payment_checkout_sessions").doc("cs_first").set(first.record);
await adminDb.collection("payment_checkout_sessions").doc("cs_second").set(second.record);
await check("signed but unregistered and mismatched payments are rejected", async () => {
  assert.equal((await security.fulfillPaymentCheckoutSession({ session: paymentFixture("cs_unknown").session, connectedAccountId: "acct_a" })).handled, false);
  assert.equal((await security.fulfillPaymentCheckoutSession({ session: first.session, connectedAccountId: "acct_b" })).handled, false);
  for (const patch of [{ amount_total: 1 }, { currency: "usd" }, { payment_status: "no_payment_required" }, { payment_status: "unpaid" }, { metadata: { ...first.session.metadata, businessId: "biz-b" } }]) {
    assert.equal(security.matchesAuthorizedCheckout({ ...first.session, ...patch }, first.record, "acct_a"), false);
  }
});
await check("concurrent completed sessions settle once and preserve the extra charge", async () => {
  await Promise.all([first, second].map(({ session }) => security.fulfillPaymentCheckoutSession({ session, connectedAccountId: "acct_a" })));
  const invoice = (await adminDb.collection("invoices").doc("invoice-a").get()).data();
  assert.equal(invoice.amountPaidAud, 100); assert.equal(invoice.payments.length, 1);
  const receipts = await adminDb.collection("payment_receipts").get();
  assert.equal(receipts.docs.filter((doc) => doc.data().reconciliationRequired).length, 1);
  assert.equal((await security.fulfillPaymentCheckoutSession({ session: first.session, connectedAccountId: "acct_a" })).alreadyFulfilled, true);
});
await check("multiple quotation deposits cannot overwrite the original payment", async () => {
  await adminDb.collection("quotations").doc("quote-a").set({ businessId: "biz-a", depositRequest: { amountAud: 100, paid: false } });
  const payments = [paymentFixture("cs_deposit1", "quote-a", "quotation_deposit"), paymentFixture("cs_deposit2", "quote-a", "quotation_deposit")];
  for (const { record } of payments) await adminDb.collection("payment_checkout_sessions").doc(record.sessionId).set(record);
  await Promise.all(payments.map(({ session }) => security.fulfillPaymentCheckoutSession({ session, connectedAccountId: "acct_a" })));
  const quotation = (await adminDb.collection("quotations").doc("quote-a").get()).data();
  assert.equal(quotation.depositPayments.length, 1); assert.equal(quotation.depositRequest.paid, true);
  assert.equal((await adminDb.collection("payment_receipts").get()).docs.filter((doc) => doc.data().targetId === "quote-a").length, 2);
});
await check("Storage URL policy rejects other hosts, buckets, and tenants", async () => {
  const base = "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/";
  assert.equal(security.trustedStorageObject(base + encodeURIComponent("items/biz-a/file.pdf"), "test-bucket", ["items/biz-a/"]), "items/biz-a/file.pdf");
  for (const url of ["https://127.0.0.1/file", "http://169.254.169.254/file", "https://example.test/file", base + encodeURIComponent("items/biz-b/file.pdf"), base.replace("test-bucket", "other-bucket") + "file.pdf", base + encodeURIComponent("items/biz-a/../biz-b/file.pdf")]) {
    assert.throws(() => security.trustedStorageObject(url, "test-bucket", ["items/biz-a/"]));
  }
  assert.equal(security.imageType(Buffer.from("not an image")), null); assert.equal(security.isPdf(Buffer.from("not PDF")), false);
});
await check("multipart bodies are capped before full buffering", async () => {
  let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(50_000)); if (pulls === 20) controller.close(); } });
  await assert.rejects(security.boundedUploadForm(new Request("http://test", { method: "POST", body: stream, duplex: "half", headers: { "Content-Type": "multipart/form-data; boundary=test" } }), 1024));
  assert.ok(pulls < 20);
});
await check("CSV formulas become text while numeric values remain numbers", async () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", "\t=1+1", "  =1+1", "\rmalicious"]) {
    assert.ok(security.buildCsv([{ name: value }]).includes("'"));
  }
  assert.ok(security.buildCsv([{ value: -42 }]).endsWith("-42"));
});
await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
await adminDb.terminate();
if (resolve(fileURLToPath(testDirectory)) !== resolve(process.cwd(), "tmp/security-tests")) throw new Error("Unexpected test cleanup path.");
rmSync(testDirectory, { recursive: true, force: true });
console.log(`${passed} focused security checks passed.`);
