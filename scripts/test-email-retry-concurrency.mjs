import assert from "node:assert/strict";
import { build } from "esbuild";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { createRequire } from "node:module";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw Error("Email concurrency tests require a local Firestore emulator.");
}
const app = initializeApp({ projectId: "demo-bms-security-test" }, "email-retry-tests");
const db = getFirestore(app);
const accepted = (id) => ({kind:"accepted",providerMessageId:id,providerThreadId:null});
const state = {
  sends: 0, beforeTransaction: null, credentialsHook: null, failEventWrite: false, actorDisabled: false,
  adapterSend: async () => accepted("accepted"),
};
state.adminDb = {
  collection: db.collection.bind(db),
  async runTransaction(callback) {
    const hook=state.beforeTransaction;
    state.beforeTransaction=null;
    if(hook)await hook();
    return db.runTransaction((tx)=>callback(new Proxy(tx, {
      get(target,key) {
        if(key==="create") return (ref,data)=>{
          if(state.failEventWrite && ref.parent.id==="email_events")throw Error("Injected audit failure");
          return target.create(ref,data);
        };
        const value=Reflect.get(target,key);
        return typeof value==="function" ? value.bind(target) : value;
      },
    })));
  },
};
state.adminAuth = { async getUser() {
  return {disabled:state.actorDisabled,customClaims:{businessId:"business",role:"owner"}};
} };
globalThis.__emailRetryTest=state;
const mocks={
  "server-only":"",
  "@/lib/firebase/admin": `export const {adminDb,adminAuth}=globalThis.__emailRetryTest;
    export const adminStorage={}; export const getStorageBucketName=()=> 'fixture';`,
  "@/lib/email-integration/credentials": `export async function freshCredentials(){
    const s=globalThis.__emailRetryTest; const hook=s.credentialsHook; s.credentialsHook=null;
    if(hook)await hook();return {ok:true,credentials:{provider:'google',accessToken:'fixture'}};
  }`,
  "@/lib/email-integration/providers": `export function getEmailAdapter(){return {
    async send(){const s=globalThis.__emailRetryTest;s.sends++;return s.adapterSend();},async revoke(){}
  };}`,
  "@/lib/email-integration/documents": ["attachmentNameFor","documentSendBlocker","generateDocumentPdf","loadEmailableDocument"]
    .map((name)=>"export function "+name+"(){throw Error('Unexpected document access');}").join("\n"),
};
const bundled=await build({
  stdin:{contents:`export * from '@/lib/email-integration/outbox';
    export {disconnectEmailConnection,getEmailConnectionById,markConnectionNeedsReconnect} from '@/lib/email-integration/connections';`,
    resolveDir:process.cwd(),loader:"ts"},
  write:false,bundle:true,platform:"node",format:"cjs",packages:"external",
  plugins:[{name:"email-retry-fixtures",setup(builder){
    builder.onResolve({filter:/.*/},({path})=>path in mocks ? {path,namespace:"fixture"}:undefined);
    builder.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({contents:mocks[path],loader:"js",resolveDir:process.cwd()}));
  }}],
});
const bundleModule={exports:{}};
new Function("require","module","exports",bundled.outputFiles[0].text)(createRequire(import.meta.url),bundleModule,bundleModule.exports);
const email=bundleModule.exports;
const ref=db.collection("email_outbox").doc("mail");
const mailbox=db.collection("email_connections").doc("connection");
async function reset(status="failed") {
  state.sends=0;state.beforeTransaction=null;state.credentialsHook=null;
  state.failEventWrite=false;state.actorDisabled=false;state.adapterSend=async()=>accepted("accepted");
  for(const collection of ["email_outbox","email_events","email_connections","users"]){
    for(const doc of (await db.collection(collection).get()).docs)await doc.ref.delete();
  }
  await mailbox.set({businessId:"business",provider:"google",providerAccountId:"account",address:"owner@example.test",status:"active",generation:1});
  await db.collection("users").doc("owner").set({businessId:"business",role:"owner",fullName:"Owner"});
  await ref.set({businessId:"business",connectionId:"connection",connectionGeneration:1,providerAccountId:"account",
    actorId:"owner",status,attemptCount:0,nextAttemptAt:Timestamp.fromMillis(0),leaseUntil:null,
    internetMessageId:"<fixture@example.test>",pdfStorageKey:null,
    payloadSnapshot:{from:"owner@example.test",fromName:"Owner",to:["recipient@example.test"],cc:[],subject:"Fixture",bodyText:"Fixture"},
    updatedAt:Timestamp.now()});
}
const retry=(patch={})=>email.retryOutboxItem({businessId:"business",actorId:"owner",outboxId:"mail",confirmUnknown:false,expectedRetryGeneration:0,...patch});
const row=async()=>(await ref.get()).data();
async function eventCount(type) {
  return (await db.collection("email_events").where("eventType","==",type).get()).size;
}
function deferred(){let resolve;const promise=new Promise((done)=>{resolve=done;});return {promise,resolve};}
function pausedAdapter() {
  const entered=deferred();const outcome=deferred();
  return {entered:entered.promise,resolve:outcome.resolve,send:async()=>{entered.resolve();return outcome.promise;}};
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
try {
  await check("a late retry cannot clear a worker claim or cause a second send",async()=>{
    await reset();const paused=pausedAdapter();state.adapterSend=paused.send;
    let worker;
    state.beforeTransaction=async()=>{
      assert.equal((await retry()).ok,true);
      worker=email.processOutboxItem("mail");await paused.entered;
    };
    assert.equal((await retry()).status,409);
    const sending=await row();assert.equal(sending.status,"sending");assert.ok(sending.leaseOwner);
    assert.equal(state.sends,1);assert.equal(await eventCount("retry_requested"),1);
    paused.resolve(accepted("one"));assert.equal(await worker,"accepted");
    assert.equal((await row()).providerMessageId,"one");
  });
  await check("concurrent retry clicks and workers permit only one adapter send",async()=>{
    await reset();const retries=await Promise.all([retry(),retry()]);
    assert.equal(retries.filter(result=>result.ok).length,1);
    await Promise.all([email.processOutboxItem("mail"),email.processOutboxItem("mail")]);
    assert.equal(state.sends,1);assert.equal((await row()).status,"accepted");
    assert.equal(await eventCount("retry_requested"),1);assert.equal(await eventCount("accepted"),1);
  });
  await check("replaying an old retry after a safe failure cannot queue another attempt",async()=>{
    await reset();assert.equal((await retry()).ok,true);
    state.adapterSend=async()=>({kind:"safe_failure",code:"rejected",detail:"Rejected",retryable:false,retryAfterSeconds:null});
    assert.equal(await email.processOutboxItem("mail"),"failed");
    assert.equal((await retry()).status,409);assert.equal(state.sends,1);
    assert.equal((await retry({expectedRetryGeneration:1})).ok,true);
    state.adapterSend=async()=>accepted("second");
    assert.equal(await email.processOutboxItem("mail"),"accepted");assert.equal(state.sends,2);
  });
  await check("unknown provider outcomes require confirmation and are never automatically resent",async()=>{
    await reset("queued");state.adapterSend=async()=>({kind:"unknown",code:"timeout",detail:"Outcome unknown"});
    assert.equal(await email.processOutboxItem("mail"),"unknown");
    assert.equal(await email.processOutboxItem("mail"),null);
    assert.equal((await email.processEmailOutbox()).processed,0);
    assert.equal((await retry()).code,"confirm_unknown");assert.equal(state.sends,1);
    assert.equal((await retry({confirmUnknown:true})).ok,true);
    assert.equal(await email.processOutboxItem("mail"),"unknown");
    assert.equal((await retry({confirmUnknown:true})).status,409);
    assert.equal(state.sends,2);
  });
  await check("expired workers cannot settle or disable a mailbox used by a newer attempt",async()=>{
    for(const oldResult of [accepted("old"),
      {kind:"auth_failure",code:"old_auth_error",detail:"Old credentials"},
      {kind:"safe_failure",code:"old_failure",detail:"Old rejection",retryable:true,retryAfterSeconds:null}]) {
      await reset("queued");const first=pausedAdapter();state.adapterSend=first.send;
      const oldWorker=email.processOutboxItem("mail");await first.entered;
      const oldOwner=(await row()).leaseOwner;
      await ref.update({leaseUntil:Timestamp.fromMillis(0)});
      assert.equal((await email.processEmailOutbox()).markedUnknown,1);
      assert.equal((await retry()).code,"confirm_unknown");
      assert.equal((await retry({confirmUnknown:true})).ok,true);
      const second=pausedAdapter();state.adapterSend=second.send;
      const newWorker=email.processOutboxItem("mail");await second.entered;
      const newOwner=(await row()).leaseOwner;assert.notEqual(newOwner,oldOwner);
      first.resolve(oldResult);assert.equal(await oldWorker,null);
      assert.equal((await row()).leaseOwner,newOwner);assert.equal((await row()).status,"sending");
      assert.equal((await mailbox.get()).data().status,"active");
      second.resolve(accepted("new"));assert.equal(await newWorker,"accepted");
      assert.equal((await row()).providerMessageId,"new");assert.equal(state.sends,2);
    }
  });
  await check("expired leases and changed connections prevent provider calls",async()=>{
    await reset("queued");state.credentialsHook=()=>ref.update({leaseUntil:Timestamp.fromMillis(0)});
    assert.equal(await email.processOutboxItem("mail"),null);assert.equal(state.sends,0);
    assert.equal((await email.processEmailOutbox()).markedUnknown,1);
    await reset("queued");state.credentialsHook=()=>mailbox.update({generation:2});
    assert.equal(await email.processOutboxItem("mail"),"held");assert.equal(state.sends,0);
  });
  await check("audit failures roll back retry and expired-lease transitions",async()=>{
    await reset();state.failEventWrite=true;
    await assert.rejects(retry());assert.equal((await row()).status,"failed");
    assert.equal((await row()).retryGeneration,undefined);assert.equal(state.sends,0);
    await reset("queued");const paused=pausedAdapter();state.adapterSend=paused.send;
    const worker=email.processOutboxItem("mail");await paused.entered;
    await ref.update({leaseUntil:Timestamp.fromMillis(0)});state.failEventWrite=true;
    await assert.rejects(email.processEmailOutbox());assert.equal((await row()).status,"sending");
    state.failEventWrite=false;assert.equal((await email.processEmailOutbox()).markedUnknown,1);
    paused.resolve(accepted("late"));assert.equal(await worker,null);
  });
  await check("connection changes and tenant mismatches reject retry without mutation",async()=>{
    await reset();state.beforeTransaction=()=>mailbox.update({generation:2,status:"disconnected"});
    assert.equal((await retry()).status,409);assert.equal((await row()).status,"failed");
    assert.equal((await retry({businessId:"other"})).status,404);assert.equal(state.sends,0);
  });
  await check("old connection failures and disconnect snapshots cannot overwrite newer state",async()=>{
    await reset();const connection=await email.getEmailConnectionById("business","connection");
    await mailbox.update({generation:2});await email.markConnectionNeedsReconnect(connection,"old_failure");
    assert.equal((await mailbox.get()).data().status,"active");
    await reset("queued");const current=await email.getEmailConnectionById("business","connection");
    state.beforeTransaction=()=>ref.update({status:"accepted",providerMessageId:"already_sent"});
    await email.disconnectEmailConnection(current,"owner");
    assert.equal((await row()).status,"accepted");assert.equal((await row()).providerMessageId,"already_sent");
  });
  await check("legacy connection and outbox records receive safe default generations",async()=>{
    await reset();await mailbox.update({generation:FieldValue.delete()});
    assert.equal((await retry({expectedRetryGeneration:undefined})).ok,true);
    assert.equal((await row()).retryGeneration,1);
    assert.equal(await email.processOutboxItem("mail"),"accepted");
    assert.equal((await row()).attemptGeneration,1);assert.equal((await row()).leaseOwner,null);
  });
  console.log(checks+" email concurrency checks passed");
} finally {
  delete globalThis.__emailRetryTest;
  await db.terminate();await deleteApp(app);
}
