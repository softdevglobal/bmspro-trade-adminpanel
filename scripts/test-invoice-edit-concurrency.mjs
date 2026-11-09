import assert from "node:assert/strict";
import { build } from "esbuild";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createRequire } from "node:module";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw Error("Invoice concurrency tests require a local Firestore emulator.");
}
const app = initializeApp({ projectId: "demo-bms-security-test" }, "invoice-edit-tests");
const db = getFirestore(app);
const state = {
  beforeTransaction: null, beforeBooking: null, onPdf: null,
  bookings: 0, emails: 0, uploads: 0, codes: 0, pdfs: [], sessions: new Map(), files: new Map(),
  quotation: {
    id: "quote", businessId: "business", quotationCode: "Q1", inspectionRequestId: "request",
    serviceTitle: "Service", status: "sent", customerDecision: "accepted",
    customer: { fullName: "Customer", email: "customer@example.test", phone: "0400000000" },
    address: { street: "1 Test St", suburb: "Melbourne", state: "VIC", postcode: "3000" },
  },
};
state.adminDb = {
  collection: db.collection.bind(db),
  async runTransaction(callback) {
    const hook = state.beforeTransaction;
    state.beforeTransaction = null;
    if (hook) await hook();
    return db.runTransaction(callback);
  },
};
globalThis.__invoiceEditTest = state;
const mocks = {
  "server-only": "",
  "@/lib/firebase/admin": "export const adminDb = globalThis.__invoiceEditTest.adminDb;",
  "@/lib/bookings/server": `export async function completeBookingForInvoicedQuotation() {
    const s=globalThis.__invoiceEditTest; s.bookings++;
    const hook=s.beforeBooking; s.beforeBooking=null; if(hook) await hook();
    return {bookingId:'job',bookingCode:'J1',bookingStatus:'completed'};
  }`,
  "@/lib/bookings/types": "export const parseBookingStatus = value => value ?? null;",
  "@/lib/quotations/server": `export async function getBusinessQuotationById(){return globalThis.__invoiceEditTest.quotation;}
    export const parseLineItems = items => items; export const serializeLineItemsForFirestore = items => items;
    export async function createStandaloneQuotation(){throw Error('Unexpected direct creation');}`,
  "@/lib/audit/server": "export async function logAuditEvent(){}",
  "@/lib/onboarding/server": `export async function getBusinessProfile(){return {
    businessName:'Business',stripeConnectAccountId:'acct',stripeConnectOnboarded:true,feePayerMode:'business'
  };}`,
  "@/lib/reference-codes.server": "export async function allocateInvoiceCode(){return 'INV'+(++globalThis.__invoiceEditTest.codes);}",
  "@/lib/inspection/types": "export const REQUESTS_COLLECTION='requests'; export const formatAddress=()=>'';",
  "@/lib/invoices/pdf": `export async function generateInvoicePdf(invoice) {
    const s=globalThis.__invoiceEditTest; s.pdfs.push(invoice);
    const hook=s.onPdf; s.onPdf=null; if(hook) await hook();
    return Buffer.from(JSON.stringify({status:invoice.status,balance:invoice.balanceDueAud}));
  }`,
  "@/lib/onboarding/services/upload": `export async function uploadInvoicePdf(bytes) {
    const s=globalThis.__invoiceEditTest; const url='https://example.test/pdf/'+(++s.uploads);
    s.files.set(url,JSON.parse(bytes.toString())); return {ok:true,url};
  }`,
  "@/lib/email/templates/invoice-sent": "export async function sendInvoiceSentEmail(){globalThis.__invoiceEditTest.emails++;}",
  "@/lib/notifications/server": "export async function notifyCustomerOfInvoiceSent(){}",
  "@/lib/stripe/client": `export function getStripe(){return {checkout:{sessions:{
    retrieve:async id=>globalThis.__invoiceEditTest.sessions.get(id)
  }}};}`,
  "@/lib/stripe/connect": "export async function getBusinessConnectAccount(){return {accountId:'acct',onboarded:true};}",
  "@/lib/stripe/config": "export const getAppBaseUrl=()=> 'https://example.test';",
  "@/lib/stripe/payment-links": `export async function resolvePaymentLink(){return {token:'token',type:'invoice',businessId:'business',targetId:'quote'};}
    export async function getOrCreatePaymentLink(){return {token:'token'};}
    export const paymentLinkPath=()=>'/pay/token';`,
};
const bundled = await build({
  stdin: { contents: `export * from '@/lib/invoices/server';
    export {fulfillPaymentCheckoutSession} from '@/lib/stripe/payment-fulfillment';
    export {getPublicPaymentContext} from '@/lib/payments/public';`, resolveDir: process.cwd(), loader: "ts" },
  write: false, bundle: true, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "invoice-fixtures", setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
  } }],
});
const bundleModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), bundleModule, bundleModule.exports);
const invoices = bundleModule.exports;
const ref = db.collection("invoices").doc("quote");
const input = { quotationId: "quote", lineItems: [{ name: "Service", priceAud: 100 }], finalPriceAud: 100, invoiceDate: "2026-11-07", dueDate: "2026-11-21" };
const save = (patch = {}) => invoices.createInvoiceFromQuotation("business", { uid: "owner" }, { ...input, ...patch });
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log("PASS " + name); }
async function reset(patch = {}) {
  state.beforeTransaction=null; state.beforeBooking=null; state.onPdf=null;
  state.bookings=0; state.emails=0; state.uploads=0; state.pdfs=[];
  state.files.clear();
  await ref.set({ ...state.quotation, quotationId: "quote", invoiceCode: "I1", status: "sent",
    finalPriceAud: 100, balanceDueAud: 100, amountPaidAud: 0, payments: [], updatedAt: Timestamp.now(), ...patch });
  await db.collection("requests").doc("request").set({ businessId: "business" });
  for (const receipt of (await db.collection("payment_receipts").get()).docs) await receipt.ref.delete();
}
async function settle() {
  const id="cs_payment";
  const record = { businessId:"business", targetId:"quote", paymentType:"invoice_payment", accountId:"acct",
    baseCents:10000, feeCents:0, totalCents:10000, currency:"aud", feePayerMode:"business", token:"token",
    reference:"I1", reservationId:"reservation", expiresAt:2000000000000, sessionId:id };
  const session = { id, mode:"payment", status:"complete", payment_status:"paid", amount_total:10000, currency:"aud",
    expires_at:2000000000, metadata:{businessId:"business",targetId:"quote",paymentType:"invoice_payment",reservationId:"reservation"},
    payment_intent:{id:"pi_payment",status:"succeeded",amount_received:10000,currency:"aud"} };
  state.sessions.set(id,session);
  await db.collection("payment_checkout_sessions").doc(id).set(record);
  const result = await invoices.fulfillPaymentCheckoutSession({ session, connectedAccountId:"acct" });
  assert.equal(result.handled,true);
  assert.equal(result.reconciliationRequired,false);
}
async function assertSettled() {
  const data=(await ref.get()).data();
  assert.equal(data.status,"paid"); assert.equal(data.balanceDueAud,0); assert.equal(data.amountPaidAud,100);
  assert.equal(data.payments.length,1);
  assert.deepEqual(state.files.get(data.pdfUrl),{status:"paid",balance:0});
  const mirror=(await db.collection("requests").doc("request").get()).data().invoice;
  assert.equal(mirror.status,"paid"); assert.equal(mirror.balanceDueAud,0);
  assert.equal((await invoices.getPublicPaymentContext("token")).canPay,false);
}
try {
  await check("edit paused after reading cannot overwrite a Stripe settlement", async () => {
    await reset(); state.beforeTransaction=settle;
    const result=await save({send:true});
    assert.equal(result.status,409); assert.equal(result.invoice.status,"paid");
    assert.equal(state.bookings,0); assert.equal(state.emails,0);
    assert.ok(state.pdfs.every((invoice)=>invoice.status==="paid"));
    await assertSettled();
  });
  await check("settlement after an edit commit remains authoritative in PDFs and mirrors", async () => {
    await reset(); state.beforeBooking=settle;
    assert.equal((await save({send:true})).ok,true);
    await assertSettled(); assert.equal(state.emails,0);
    assert.equal(state.pdfs.at(-1).status,"paid"); assert.equal(state.pdfs.at(-1).balanceDueAud,0);
  });
  await check("PDF rendered during settlement cannot publish a stale URL or send an unpaid reminder", async () => {
    await reset(); state.onPdf=settle;
    assert.equal((await save({send:true})).ok,true);
    await assertSettled(); assert.equal(state.emails,0);
  });
  await check("cancellation wins over an edit that already read the invoice", async () => {
    await reset(); state.beforeTransaction=()=>invoices.cancelBusinessInvoice("business","quote");
    assert.equal((await save()).status,409); assert.equal((await ref.get()).data().status,"cancelled");
    assert.equal(state.bookings,0); assert.equal(state.uploads,0);
  });
  await check("two concurrent editors cannot overwrite the first committed revision", async () => {
    await reset(); state.beforeTransaction=async()=>assert.equal((await save({finalPriceAud:130,notes:"winner"})).ok,true);
    assert.equal((await save({notes:"stale"})).status,409);
    assert.equal((await ref.get()).data().notes,"winner"); assert.equal((await ref.get()).data().balanceDueAud,130);
  });
  await check("a stale editor timestamp receives the latest invoice without side effects", async () => {
    await reset(); const stamp=(await invoices.getBusinessInvoiceByQuotationId("business","quote")).updatedAt;
    await ref.update({updatedAt:Timestamp.fromMillis(stamp+1000),notes:"newer"});
    const result=await save({expectedUpdatedAt:stamp});
    assert.equal(result.status,409); assert.equal(result.invoice.notes,"newer"); assert.equal(state.bookings,0);
  });
  await check("duplicate creation from a quotation creates only one invoice and booking", async () => {
    await reset(); await ref.delete();
    state.beforeTransaction=async()=>assert.equal((await save()).ok,true);
    assert.equal((await save()).status,409); assert.equal(state.bookings,1);
    assert.equal((await save({createOnly:true})).status,409);
    assert.equal(state.bookings,1);
  });
  await check("legacy partial-payment ledgers and received deposits reduce the edited balance", async () => {
    await reset({amountPaidAud:0,payments:[{amountAud:40}],balanceDueAud:60});
    assert.equal((await save({finalPriceAud:120})).ok,true);
    assert.equal((await ref.get()).data().balanceDueAud,80); assert.equal((await ref.get()).data().amountPaidAud,40);
    await reset({depositRequest:{mode:"fixed",amountAud:20,dueDate:"2026-11-01",paid:true},balanceDueAud:80});
    assert.equal((await save({depositRequest:null})).ok,true);
    assert.equal((await ref.get()).data().balanceDueAud,80);
    assert.equal((await save({finalPriceAud:10})).status,409);
  });
  console.log(checks+" invoice concurrency checks passed");
} finally {
  delete globalThis.__invoiceEditTest;
  await db.terminate(); await deleteApp(app);
}
