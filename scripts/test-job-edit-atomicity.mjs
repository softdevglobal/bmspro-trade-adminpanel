import assert from "node:assert/strict";
import { build } from "esbuild";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createRequire } from "node:module";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw Error("Job edit tests require a local Firestore emulator.");
}
const app = initializeApp({ projectId: "demo-bms-security-test" }, "job-edit-tests");
const db = getFirestore(app);
const state = {
  notifications: [], alerts: 0, events: [], validations: 0,
  scheduleBlocked: false, leave: null, offDay: false, beforeTransaction: null, failUpdatePath: null,
};
state.adminDb = {
  collection: db.collection.bind(db),
  async runTransaction(callback) {
    const hook = state.beforeTransaction;
    state.beforeTransaction = null;
    if (hook) await hook();
    return db.runTransaction((tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === "update") return (ref, fields) => {
          if (ref.path === state.failUpdatePath) throw Error("Injected write failure");
          return target.update(ref, fields);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    })));
  },
};
globalThis.__jobEditTest = state;
const unusedBookingFunctions = [
  "assignBusinessBooking", "cancelBusinessBooking", "completeBusinessBooking", "markBusinessBookingMissed",
  "deleteBusinessBooking", "notifyStaffOfJobAssignment", "undoCancelBusinessBooking", "updateBookingCompletionPhotos",
  "updateBusinessBookingSchedule", "startBusinessBookingJob", "startBusinessBookingVisit",
];
const mocks = {
  "server-only": "",
  "next/server": "export const NextResponse={json:(body,init)=>Response.json(body,init)};",
  "@/lib/firebase/admin": "export const adminDb=globalThis.__jobEditTest.adminDb;",
  "@/lib/auth/account-access": "export async function verifyAccountIdToken(){return {uid:'owner',role:'owner',businessId:'business'};}",
  "@/lib/notifications/auth-token": `export const extractBearerToken=request=>request.headers.get('authorization')?.slice(7);
    export async function requireBusinessOwnerFromToken(token){return token==='owner'
      ? {ok:true,uid:'owner',businessId:'business'} : {ok:false,status:403,error:'Denied'};}`,
  "@/lib/audit/server": "export async function logAuditEvent(){}",
  "@/lib/bookings/server": `import {mapBookingDoc} from '@/lib/bookings/map-booking-doc';
    const db=globalThis.__jobEditTest.adminDb;
    export async function getBusinessBooking(businessId,id){const snap=await db.collection('jobs').doc(id).get();
      return snap.exists && snap.data().businessId===businessId ? mapBookingDoc(id,snap.data()) : null;}
    export async function listBookingsInSeries(businessId,seriesId){
      const snap=await db.collection('jobs').where('seriesId','==',seriesId).get();
      return snap.docs.map(doc=>mapBookingDoc(doc.id,doc.data())).filter(job=>job.businessId===businessId);}
    export const isSeriesScheduleLocked=job=>['completed','cancelled','missed','ongoing'].includes(job.status);
    export async function validateBusinessBookingSchedule(){const s=globalThis.__jobEditTest;s.validations++;
      return s.scheduleBlocked ? {ok:false,status:400,error:'No capacity'} : {ok:true};}
    export async function notifyBusinessBookingRescheduled(job){globalThis.__jobEditTest.notifications.push(job);}
    ${unusedBookingFunctions.map((name) => "export async function " + name + "(){throw Error('Unexpected mutation helper " + name + "');}").join("\n")}`,
  "@/lib/leave/server": `export async function findApprovedLeaveBlocking(){return globalThis.__jobEditTest.leave;}
    export async function findLeaveBlockingAssignment(){return globalThis.__jobEditTest.leave;}`,
  "@/lib/team/staff-off-day-server": "export async function staffIsOffOnDate(){return globalThis.__jobEditTest.offDay;}",
  "@/lib/notifications/server": `export async function notifyBusinessOfStaffOffDayAssignment(){globalThis.__jobEditTest.alerts++;}
    export async function notifyBusinessOfStaffOnLeaveAssignment(){globalThis.__jobEditTest.alerts++;}`,
  "@/lib/integrations/careplus/enqueue": "export async function enqueueCareplusActivitySafe(job,type){globalThis.__jobEditTest.events.push({job,type});}",
};
const bundled = await build({
  stdin: { contents: "export {PATCH} from './app/api/jobs/[id]/route';", resolveDir: process.cwd(), loader: "ts" },
  write: false, bundle: true, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "job-edit-fixtures", setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], loader: "js", resolveDir: process.cwd() }));
  } }],
});
const bundleModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), bundleModule, bundleModule.exports);
const { PATCH } = bundleModule.exports;
const jobRef = db.collection("jobs").doc("job");
const initial = {
  businessId: "business", status: "scheduled", serviceId: "service", serviceName: "Service", requestType: "existing_service",
  customer: { fullName: "Original Customer", email: "customer@example.test", phone: "0400000000" },
  address: { street: "1 Test St", suburb: "Melbourne", state: "VIC", postcode: "3000" },
  scheduledSlot: { date: "2026-12-01", timeRange: "morning" }, scheduledStartTime: "09:00", scheduledEndTime: "10:00",
  inspectionRequestId: "request", quotationId: "quote", bookingCode: "J1", updatedAt: Timestamp.fromMillis(1000),
};
const payload = {
  action: "update_details", requestType: "existing_service", serviceId: "service",
  slot: { date: "2026-12-02", timeRange: "morning" }, startTime: "10:00", endTime: "11:00", recurrence: false,
};
async function reset(patch = {}) {
  state.notifications=[]; state.alerts=0; state.events=[]; state.validations=0;
  state.scheduleBlocked=false; state.leave=null; state.offDay=false;
  state.beforeTransaction=null; state.failUpdatePath=null;
  for (const collection of ["jobs", "requests", "quotations", "services", "users"]) {
    for (const doc of (await db.collection(collection).get()).docs) await doc.ref.delete();
  }
  await jobRef.set({ ...initial, ...patch });
  await db.collection("requests").doc("request").set({businessId:"business",customer:initial.customer});
  await db.collection("quotations").doc("quote").set({businessId:"business",customer:initial.customer});
  await db.collection("services").doc("service").set({businessId:"business",name:"Service",isActive:true});
}
async function save(patch = {}) {
  return PATCH(new Request("https://example.test/api/jobs/job", {
    method:"PATCH", headers:{authorization:"Bearer owner","content-type":"application/json"},
    body:JSON.stringify({...payload,...patch}),
  }), {params:Promise.resolve({id:"job"})});
}
async function records() {
  return Promise.all([jobRef,db.collection("requests").doc("request"),db.collection("quotations").doc("quote")]
    .map(async (ref)=>(await ref.get()).data()));
}
function assertNoEffects() {
  assert.deepEqual(state.notifications,[]); assert.deepEqual(state.events,[]); assert.equal(state.alerts,0);
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
try {
  await check("invalid service, scope, recurrence, customer, address and time leave every record untouched",async()=>{
    for (const patch of [
      {serviceId:""}, {serviceId:"missing"}, {requestType:"custom_quote",customRequest:{title:""}},
      {recurrence:{interval:0}}, {customer:{fullName:""}}, {customer:{email:"bad"}}, {customer:{phone:{bad:true}}},
      {address:{postcode:"invalid"}}, {startTime:"10:99"}, {slot:{date:"2026-02-30",timeRange:"morning"}},
    ]) {
      await reset(); const before=await records();
      assert.equal((await save(patch)).status,400);
      assert.deepEqual(await records(),before); assertNoEffects(); assert.equal(state.validations,0);
    }
  });
  await check("foreign and inactive services are rejected before any write",async()=>{
    for (const patch of [{businessId:"other"},{isActive:false}]) {
      await reset(); await db.collection("services").doc("service").update(patch);
      const before=await records(); assert.equal((await save()).status,400);
      assert.deepEqual(await records(),before); assertNoEffects();
    }
  });
  await check("capacity and staff availability failures cause no writes or notification attempts",async()=>{
    await reset(); state.scheduleBlocked=true; const before=await records();
    assert.equal((await save()).status,400); assert.deepEqual(await records(),before); assertNoEffects();
    for (const blocked of ["leave","offDay"]) {
      await reset({assignedTo:{type:"staff",uid:"staff",name:"Staff"}});
      await db.collection("users").doc("staff").set({businessId:"business",role:"staff",isActive:true});
      if(blocked==="leave")state.leave={status:"approved"};else state.offDay=true;
      const original=await records(); assert.equal((await save()).status,409);
      assert.deepEqual(await records(),original); assertNoEffects();
    }
  });
  await check("failure while committing a mirror rolls back both schedule and details",async()=>{
    await reset(); const before=await records(); state.failUpdatePath="quotations/quote";
    assert.equal((await save({customer:{fullName:"Updated Customer"}})).status,500);
    assert.deepEqual(await records(),before); assertNoEffects();
  });
  await check("a stale edit cannot overwrite cancellation or change the appointment",async()=>{
    await reset(); state.beforeTransaction=()=>jobRef.update({status:"cancelled"});
    assert.equal((await save()).status,409);
    assert.deepEqual((await jobRef.get()).data().scheduledSlot,initial.scheduledSlot); assertNoEffects();
  });
  await check("successful edits update schedule and mirrors before notification, and repeat Save does not reschedule",async()=>{
    await reset(); assert.equal((await save({customer:{fullName:"Updated Customer"}})).status,200);
    const [job,request,quote]=await records();
    assert.deepEqual(job.scheduledSlot,payload.slot);
    assert.equal(job.customer.fullName,"Updated Customer"); assert.equal(request.customer.fullName,"Updated Customer");
    assert.equal(quote.customer.fullName,"Updated Customer"); assert.equal(state.notifications.length,1);
    assert.equal(state.notifications[0].customer.fullName,"Updated Customer");
    assert.equal((await save({customer:{fullName:"Updated Customer"}})).status,200);
    assert.equal(state.notifications.length,1); assert.equal(state.validations,1);
  });
  await check("detail-only edits preserve the appointment and do not send reschedule notifications",async()=>{
    await reset(); assert.equal((await save({slot:initial.scheduledSlot,startTime:"09:00",endTime:"10:00",ownerNote:"Details only"})).status,200);
    assert.deepEqual((await jobRef.get()).data().scheduledSlot,initial.scheduledSlot);
    assert.equal(state.validations,0); assert.equal(state.notifications.length,0);
  });
  await check("series cancellation and its mirrors roll back together on a commit failure",async()=>{
    await reset({seriesId:"series"});
    await db.collection("jobs").doc("sibling").set({...initial,seriesId:"series",inspectionRequestId:"sibling-request",quotationId:"sibling-quote"});
    await db.collection("requests").doc("sibling-request").set({businessId:"business"});
    await db.collection("quotations").doc("sibling-quote").set({businessId:"business",inspectionRequestId:"sibling-request"});
    state.failUpdatePath="quotations/sibling-quote";
    const before=await records(); assert.equal((await save()).status,500);
    assert.deepEqual(await records(),before);
    assert.equal((await db.collection("jobs").doc("sibling").get()).data().status,"scheduled"); assertNoEffects();
    state.failUpdatePath=null;
    assert.equal((await save()).status,200);
    assert.equal((await db.collection("jobs").doc("sibling").get()).data().status,"cancelled");
    assert.equal((await db.collection("requests").doc("sibling-request").get()).data().bookingStatus,"cancelled");
  });
  console.log(checks+" job edit checks passed");
} finally {
  delete globalThis.__jobEditTest;
  await db.terminate(); await deleteApp(app);
}
