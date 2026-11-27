import assert from "node:assert/strict";
import test,{beforeEach,after} from "node:test";
// @ts-expect-error Node runtime supports synchronous hooks.
import {registerHooks} from "node:module";
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {invoiceResponseInput,invoiceHoldMessage,invoiceCallLogMatches} from "../lib/ai/calls/invoice-follow-up-policy";
import {INVOICE_NO_ANSWER_RETRY_DELAY_MS} from "../lib/invoices/follow-up-timing";

type Row=Record<string,unknown>;
const state={rows:new Map<string,Row>(),dials:[] as Row[],bridgeStatus:"ANSWERED",optedOut:false,hours:true};
(globalThis as {__invoiceFollowUp?:typeof state}).__invoiceFollowUp=state;
const folder=mkdtempSync(join(tmpdir(),"invoice-followup-"));
const sources={
 "lib/firebase/admin":`
 const s=globalThis.__invoiceFollowUp;
 const snap=ref=>({id:ref.id,ref,exists:s.rows.has(ref.path),data:()=>s.rows.get(ref.path),get:key=>key.split('.').reduce((row,part)=>row?.[part],s.rows.get(ref.path))});
 const ref=(name,id)=>({id,path:name+':'+id,get:async()=>snap(ref(name,id)),update:async patch=>s.rows.set(name+':'+id,{...s.rows.get(name+':'+id),...patch}),set:async(patch,options)=>s.rows.set(name+':'+id,options?.merge?{...s.rows.get(name+':'+id),...patch}:patch)});
 const collection=name=>{const q=(clauses=[])=>({where(field,op,value){return q([...clauses,[field,op,value]])},limit(){return this},select(){return this},get:async()=>({docs:[...s.rows].filter(([key,row])=>key.startsWith(name+':')&&clauses.every(([field,op,value])=>op==='in'?value.includes(row[field]):row[field]===value)).map(([key])=>snap(ref(name,key.slice(name.length+1))))})});return {...q(),doc:id=>ref(name,id)}};
 exports.adminDb={collection,async runTransaction(run){let wrote=false;const get=async ref=>{if(wrote)throw Error('Read after write');return snap(ref)};return run({get,getAll:async(...refs)=>Promise.all(refs.map(get)),update(ref,patch){wrote=true;s.rows.set(ref.path,{...s.rows.get(ref.path),...patch})},set(ref,row){wrote=true;s.rows.set(ref.path,row)},create(ref,row){wrote=true;if(s.rows.has(ref.path))throw Error('Already exists');s.rows.set(ref.path,row)}})}};`,
 "lib/invoices/server":`exports.INVOICE_COLLECTION='invoices';exports.mapInvoiceDoc=(id,row)=>({id,...row});`,
 "lib/onboarding/server":`exports.getBusinessProfile=async()=>({timezone:'Australia/Melbourne',enabledModules:{invoices:true},sophieInvoiceCallsEnabled:true});`,
 "lib/ai/data/did-mappings":`exports.DID_MAPPINGS_COLLECTION='ai_did_mappings';exports.lookupVoiceDidRoute=async did=>({state:'active',binding:{businessId:'biz',did},callback:{callerId:did}});`,
 "lib/ai/calls/call-preferences":`exports.isCustomerCallOptedOut=async()=>globalThis.__invoiceFollowUp.optedOut;`,
 "lib/ai/calls/calling-hours":`exports.isWithinSophieCallingHours=()=>globalThis.__invoiceFollowUp.hours;`,
 "lib/ai/calls/due-scheduled-callbacks":`exports.loadDueScheduledCallbacks=async db=>(await db.collection('ai_scheduled_callbacks').get()).docs.filter(doc=>doc.get('status')==='SCHEDULED'&&doc.get('scheduledAt')<=Date.now());`,
 "lib/ai/calls/request-callback":`exports.callbackTransportCode=()=>"FIXTURE_ERROR";exports.requestSophieCallback=async value=>{globalThis.__invoiceFollowUp.dials.push(value);return Response.json({status:globalThis.__invoiceFollowUp.bridgeStatus})};`,
 "lib/ai/owner-call/auth":`exports.requireSophieOwner=async request=>request.headers.get('authorization')==='Bearer owner'?{ok:true,uid:'owner-a',businessId:'biz'}:{ok:false,status:403,error:'Owner only'};`,
 "lib/onboarding/services/server":`exports.requireBusinessOwner=async()=>({ok:false,status:403,error:'Fixture'});`,
 "lib/security/rate-limit":`exports.consumeRateLimits=async()=>true;`,
 "lib/audit/server":`exports.logAuditEvent=async()=>{};`,
};
const files:string[]=[];const paths=new Map<string,string>();
for(const [key,source] of Object.entries(sources)){const file=join(folder,key.replaceAll("/","-")+".cjs");writeFileSync(file,source);files.push(file);paths.set(key,pathToFileURL(file).href);}
const hook=registerHooks({resolve(specifier:string,context:{parentURL?:string},next:(specifier:string,context:unknown)=>unknown){let key=specifier.startsWith("@/")?specifier.slice(2):null;if(specifier.startsWith("./")&&context.parentURL?.includes("/lib/ai/calls/"))key="lib/ai/calls/"+specifier.slice(2);return key&&paths.has(key)?{url:paths.get(key),shortCircuit:true}:next(specifier,context);}});
after(()=>{hook.deregister();files.forEach(unlinkSync);rmdirSync(folder);});
const binding={businessId:"biz",did:"0359111403"},id="a".repeat(64),number="0412345678",key="412345678";
const attempt=()=>state.rows.get("ai_invoice_call_attempts:"+id)!;
const invoice=()=>state.rows.get("invoices:invoice-a")!;
beforeEach(()=>{
 state.rows.clear();state.dials=[];state.bridgeStatus="ANSWERED";state.optedOut=false;state.hours=true;
 state.rows.set("businesses:biz",{ownerUid:"owner-a",isActive:true,sophieInvoiceCallsEnabled:true,timezone:"Australia/Melbourne"});
 state.rows.set("invoices:invoice-a",{businessId:"biz",invoiceCode:"INV-1",status:"sent",dueDate:"2020-01-01",serviceTitle:"Light repair",balanceDueAud:100,amountPaidAud:20,customer:{fullName:"Sam",phone:number}});
 state.rows.set("ai_invoice_call_attempts:"+id,{businessId:"biz",did:binding.did,invoiceId:"invoice-a",numberKey:key,attemptedAt:Date.now(),status:"REQUESTED"});
 process.env.AI_SOPHIE_CALLBACK_ENABLED="true";process.env.AI_SOPHIE_INVOICE_CALLS_ENABLED="true";
});
test("responses validate dates and cannot supply payment amounts or changes",()=>{
 assert.equal(invoiceResponseInput.safeParse({outcome:"promised_payment"}).success,false);
 for(const promisedDate of ["2027-02-30","2027-99-01"])assert.equal(invoiceResponseInput.safeParse({outcome:"promised_payment",promisedDate}).success,false);
 assert.equal(invoiceResponseInput.safeParse({outcome:"reported_paid",amountPaidAud:100}).success,false);
});
test("only a current matching attempt and phone can read the invoice; details use settled balance",async()=>{
 const {readFollowUpInvoice}=await import("../lib/ai/calls/invoice-follow-up-actions");
 assert.equal((await readFollowUpInvoice({...binding,businessId:"other"},id,number)).status,"UNAVAILABLE");
 assert.equal((await readFollowUpInvoice(binding,id,"0499999999")).status,"UNAVAILABLE");
 const details=await readFollowUpInvoice(binding,id,number);assert.equal(details.status,"OK");assert.ok("invoice" in details);assert.equal(details.invoice?.outstandingAud,80);
 invoice().customer={fullName:"Sam",phone:"0499999999"};assert.equal((await readFollowUpInvoice(binding,id,number)).status,"UNAVAILABLE");
});
test("reported payment pauses collections and notifies the owner without recording payment",async()=>{
 const {readFollowUpInvoice,recordInvoiceCustomerResponse}=await import("../lib/ai/calls/invoice-follow-up-actions");
 assert.equal((await recordInvoiceCustomerResponse(binding,id,number,{outcome:"reported_paid"})).status,"REJECTED");
 await readFollowUpInvoice(binding,id,number);
 assert.equal((await recordInvoiceCustomerResponse(binding,id,number,{outcome:"reported_paid"})).status,"RECORDED");
 assert.equal(invoice().status,"sent");assert.equal(invoice().amountPaidAud,20);assert.equal(invoice().balanceDueAud,100);
 assert.match(invoiceHoldMessage(invoice())!,/verify receipt/);
 assert.ok(state.rows.has("business_notifications:invoice-followup-"+id));
 assert.equal((await readFollowUpInvoice(binding,id,number)).status,"STOP");
 const count=state.rows.size;assert.equal((await recordInvoiceCustomerResponse(binding,id,number,{outcome:"reported_paid"})).status,"RECORDED");assert.equal(state.rows.size,count);
 assert.equal((await recordInvoiceCustomerResponse(binding,id,number,{outcome:"disputed"})).status,"REJECTED");
});
test("dispute, hardship, plans and promises stay paused without automatic expiry",async()=>{
 const {readFollowUpInvoice,recordInvoiceCustomerResponse}=await import("../lib/ai/calls/invoice-follow-up-actions");
 await readFollowUpInvoice(binding,id,number);
 for(const outcome of ["disputed","hardship","payment_plan_requested","promised_payment","needs_help"]){
   delete attempt().customerResponse;
   const response={outcome,...(outcome==="promised_payment"?{promisedDate:"2027-01-01"}:{})};
   assert.equal((await recordInvoiceCustomerResponse(binding,id,number,response)).status,"RECORDED");
   const hold=invoice().sophieCollectionHold as Row;assert.equal(hold.active,true);assert.equal(hold.expiresAt,undefined);
 }
});
test("active checkout and reconciliation pause contact without claiming payment",async()=>{
 const {invoiceContactBlock}=await import("../lib/ai/calls/invoice-contact-guard");
 const target=createHash("sha256").update("biz:invoice_payment:invoice-a").digest("hex");
 state.rows.set("payment_checkout_targets:"+target,{businessId:"biz",targetId:"invoice-a",sessionId:"cs_test",expiresAt:Date.now()+60000});
 assert.match((await invoiceContactBlock("biz","invoice-a",invoice()))!,/checkout/);
 state.rows.set("payment_receipts:cs_test",{businessId:"biz",targetId:"invoice-a",reconciliationRequired:true});
 assert.match((await invoiceContactBlock("biz","invoice-a",invoice()))!,/reconciliation/);
 assert.equal(invoice().status,"sent");
});
test("settled invoices and old or completed attempts do not disclose invoice data",async()=>{
 const {readFollowUpInvoice}=await import("../lib/ai/calls/invoice-follow-up-actions");
 invoice().status="paid";assert.equal((await readFollowUpInvoice(binding,id,number)).status,"STOP");
 attempt().attemptedAt=Date.now()-3*3600000;assert.equal((await readFollowUpInvoice(binding,id,number)).status,"UNAVAILABLE");
 attempt().attemptedAt=Date.now();attempt().conversationEndedAt=Date.now();assert.equal((await readFollowUpInvoice(binding,id,number)).status,"UNAVAILABLE");
});

test("automatic queue rechecks the hold and open checkout immediately before claiming a call",async()=>{
 const {runOverdueInvoiceCalls}=await import("../lib/ai/calls/run-overdue-invoice-calls");
 state.rows.set("ai_did_mappings:"+binding.did,{businessId:"biz",isActive:true,callback:{callerId:binding.did}});
 attempt().status="QUEUED";attempt().queuedAt=Date.now();invoice().overdueReminderCallId=id;
 invoice().sophieCollectionHold={active:true,id,reason:"reported_paid",createdAt:Date.now()};
 await runOverdueInvoiceCalls();assert.equal(state.dials.length,0);assert.equal(attempt().status,"SKIPPED");
 invoice().sophieCollectionHold={active:false};attempt().status="QUEUED";
 const target=createHash("sha256").update("biz:invoice_payment:invoice-a").digest("hex");
 state.rows.set("payment_checkout_targets:"+target,{businessId:"biz",targetId:"invoice-a",expiresAt:Date.now()+60000});
 await runOverdueInvoiceCalls();assert.equal(state.dials.length,0);
 state.rows.delete("payment_checkout_targets:"+target);attempt().status="QUEUED";
 await runOverdueInvoiceCalls();assert.equal(state.dials.length,1);assert.equal(attempt().numberKey,key);
});

test("only the current owner can resume the exact reviewed hold; resuming never dials or records money",async()=>{
 const {PATCH}=await import("../app/api/business/sophie-invoice-call/route");
 const holdToken="11111111-1111-4111-8111-111111111111";
 invoice().sophieCollectionHold={active:true,id,reviewToken:holdToken,reason:"disputed",createdAt:Date.now()};
 const review=(token:string,holdId=id,reviewed=true)=>PATCH(new Request("http://localhost/api/business/sophie-invoice-call",{method:"PATCH",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({invoiceId:"invoice-a",holdId,holdToken,reviewed})}));
 assert.equal((await review("staff")).status,403);
 assert.equal((await review("owner",id,false)).status,400);
 assert.equal((await review("owner","b".repeat(64))).status,409);
 (invoice().sophieCollectionHold as Row).reviewToken="22222222-2222-4222-8222-222222222222";assert.equal((await review("owner")).status,409);(invoice().sophieCollectionHold as Row).reviewToken=holdToken;
 invoice().businessId="other";assert.equal((await review("owner")).status,409);invoice().businessId="biz";
 assert.equal((await review("owner")).status,200);
 assert.equal(invoiceHoldMessage(invoice()),null);assert.equal(invoice().status,"sent");assert.equal(invoice().amountPaidAud,20);assert.equal(state.dials.length,0);
});

test("uncertain call outcomes require review and cannot replace a customer dispute",async()=>{
 const {holdUnverifiedInvoiceCall}=await import("../lib/ai/calls/invoice-contact-guard");
 const {adminDb}=await import("@/lib/firebase/admin");
 await adminDb.runTransaction(tx=>holdUnverifiedInvoiceCall(tx,"biz","invoice-a",id));
 assert.match(invoiceHoldMessage(invoice())!,/unverified/);
 invoice().sophieCollectionHold={active:true,id,reason:"disputed",createdAt:Date.now()};
 await adminDb.runTransaction(tx=>holdUnverifiedInvoiceCall(tx,"biz","invoice-a","b".repeat(64)));
 assert.match(invoiceHoldMessage(invoice())!,/disputed/);
});

test("wrong-person answers are flagged without reading debt details; the old number cannot be resumed",async()=>{
 const {recordInvoiceCustomerResponse,readFollowUpInvoice}=await import("../lib/ai/calls/invoice-follow-up-actions");
 const {PATCH}=await import("../app/api/business/sophie-invoice-call/route");
 assert.equal(attempt().detailsReadAt,undefined);
 assert.equal((await recordInvoiceCustomerResponse(binding,id,number,{outcome:"wrong_person"})).status,"RECORDED");
 assert.equal(attempt().detailsReadAt,undefined);assert.equal(invoice().amountPaidAud,20);assert.equal(invoice().status,"sent");
 assert.match(invoiceHoldMessage(invoice())!,/Wrong person/);assert.equal((await readFollowUpInvoice(binding,id,number)).status,"STOP");
 const hold=invoice().sophieCollectionHold as Row;
 const review=()=>PATCH(new Request("http://localhost",{method:"PATCH",headers:{Authorization:"Bearer owner"},body:JSON.stringify({invoiceId:"invoice-a",holdId:id,holdToken:hold.reviewToken,reviewed:true})}));
 assert.equal((await review()).status,409);
 invoice().customer={fullName:"Sam",phone:"0499999999"};assert.equal((await review()).status,200);
 assert.equal(state.dials.length,0);
});

test("response transcripts must match the actual attempt, business, DID and pinned phone",()=>{
 const a={businessId:"biz",did:binding.did,numberKey:key},log={businessId:"biz",did:binding.did,callerKey:key,callbackAttemptId:id};
 assert.equal(invoiceCallLogMatches(id,a,log),true);
 for(const patch of [{businessId:"other"},{did:"0359111499"},{callerKey:"other"},{callbackAttemptId:"b".repeat(64)}])assert.equal(invoiceCallLogMatches(id,a,{...log,...patch}),false);
});

test("owner reports never attach an older answered conversation to the latest failed attempt",async()=>{
 const {recentOverdueInvoiceCalls}=await import("../lib/ai/calls/invoice-call-history");
 const older="b".repeat(64);
 state.rows.set("ai_invoice_call_attempts:"+older,{...attempt(),status:"ANSWERED",attemptedAt:Date.now()-60000});
 state.rows.set("ai_call_logs:older-call",{businessId:"biz",did:binding.did,callerKey:key,callbackAttemptId:older,answered:true,transcript:[{speaker:"caller",text:"An older response",atMs:1000}]});
 attempt().status="UNKNOWN";
 assert.equal((await recentOverdueInvoiceCalls("biz",["invoice-a"])).calls[0].customerResponse,null);
 state.rows.set("ai_call_logs:latest-call",{businessId:"biz",did:binding.did,callerKey:key,callbackAttemptId:id,answered:true,transcript:[{speaker:"caller",text:"The current response",atMs:1000}]});
 const report=await recentOverdueInvoiceCalls("biz",["invoice-a"]);
 assert.deepEqual(report.calls[0].customerResponse?.excerpts,["The current response"]);
});

test("confirmed no answer creates exactly one two-minute retry; the next worker cannot dial it early",async t=>{
 let now=Date.now();t.mock.method(Date,"now",()=>now);
 const {runOverdueInvoiceCalls}=await import("../lib/ai/calls/run-overdue-invoice-calls");
 const {runScheduledSophieCallbacks}=await import("../lib/ai/calls/run-scheduled-callbacks");
 state.rows.set("ai_did_mappings:"+binding.did,{businessId:"biz",isActive:true,callback:{callerId:binding.did}});
 attempt().status="QUEUED";attempt().queuedAt=now;invoice().overdueReminderCallId=id;state.bridgeStatus="NO_ANSWER";
 await runOverdueInvoiceCalls();assert.equal(attempt().status,"NO_ANSWER");assert.equal(state.dials.length,1);
 const retryId=attempt().noAnswerRetryId as string,scheduled=state.rows.get("ai_scheduled_callbacks:"+retryId)!;
 assert.equal(scheduled.scheduledAt,now+INVOICE_NO_ANSWER_RETRY_DELAY_MS);assert.equal(INVOICE_NO_ANSWER_RETRY_DELAY_MS,120000);
 const {invoiceContactBlock}=await import("../lib/ai/calls/invoice-contact-guard");
 assert.match((await invoiceContactBlock("biz","invoice-a",invoice()))!,/retry/);
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,1);
 now=Number(scheduled.scheduledAt)-1;await runScheduledSophieCallbacks();assert.equal(state.dials.length,1);
 now++;await runScheduledSophieCallbacks();assert.equal(state.dials.length,2);
 assert.equal(state.rows.get("ai_invoice_call_attempts:"+retryId)?.status,"NO_ANSWER");
 assert.equal([...state.rows.keys()].filter(key=>key.startsWith("ai_scheduled_callbacks:")).length,1);
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,2);
});

test("retry scheduling is idempotent and refuses paused, opted-out or changed contacts",async()=>{
 const {scheduleInvoiceNoAnswerRetry}=await import("../lib/ai/calls/invoice-no-answer-retry");
 const {adminDb}=await import("@/lib/firebase/admin");
 const schedule=()=>adminDb.runTransaction(tx=>scheduleInvoiceNoAnswerRetry(tx,"biz","invoice-a",id));
 invoice().sophieCollectionHold={active:true,reason:"disputed"};await schedule();assert.equal(attempt().noAnswerRetryId,undefined);
 delete invoice().sophieCollectionHold;state.optedOut=true;await schedule();assert.equal(attempt().noAnswerRetryId,undefined);
 state.optedOut=false;const contact=invoice().customer;invoice().customer={phone:"0499999999",fullName:"Sam"};await schedule();assert.equal(attempt().noAnswerRetryId,undefined);
 invoice().customer=contact;await schedule();const count=state.rows.size;await schedule();assert.equal(state.rows.size,count);
});

test("answered, failed and unknown invoice calls do not receive a no-answer retry",async()=>{
 const {runOverdueInvoiceCalls}=await import("../lib/ai/calls/run-overdue-invoice-calls");
 state.rows.set("ai_did_mappings:"+binding.did,{businessId:"biz",isActive:true,callback:{callerId:binding.did}});
 for(const status of ["ANSWERED","FAILED","UNKNOWN"]){
  attempt().status="QUEUED";attempt().queuedAt=Date.now();invoice().overdueReminderCallId=id;state.bridgeStatus=status;
  await runOverdueInvoiceCalls();assert.equal(attempt().noAnswerRetryId,undefined);
 }
 assert.equal([...state.rows.keys()].filter(key=>key.startsWith("ai_scheduled_callbacks:")).length,0);
});

test("a retry is cancelled when a dispute is recorded during the two-minute wait",async t=>{
 const {scheduleInvoiceNoAnswerRetry}=await import("../lib/ai/calls/invoice-no-answer-retry");
 const {adminDb}=await import("@/lib/firebase/admin");
 await adminDb.runTransaction(tx=>scheduleInvoiceNoAnswerRetry(tx,"biz","invoice-a",id));
 const retryId=attempt().noAnswerRetryId as string,row=state.rows.get("ai_scheduled_callbacks:"+retryId)!;
 const now=Number(row.scheduledAt);t.mock.method(Date,"now",()=>now);
 invoice().sophieCollectionHold={active:true,reason:"disputed"};
 const {runScheduledSophieCallbacks}=await import("../lib/ai/calls/run-scheduled-callbacks");
 await runScheduledSophieCallbacks();assert.equal(state.rows.get("ai_scheduled_callbacks:"+retryId)?.status,"CANCELLED");assert.equal(state.dials.length,0);
});

test("a due retry waits for calling hours and an existing customer call to finish",async t=>{
 const {scheduleInvoiceNoAnswerRetry}=await import("../lib/ai/calls/invoice-no-answer-retry");
 const {callbackState}=await import("../lib/ai/calls/callback-state");
 const {adminDb}=await import("@/lib/firebase/admin");
 await adminDb.runTransaction(tx=>scheduleInvoiceNoAnswerRetry(tx,"biz","invoice-a",id));
 const retryId=attempt().noAnswerRetryId as string,row=state.rows.get("ai_scheduled_callbacks:"+retryId)!;
 let now=Number(row.scheduledAt);t.mock.method(Date,"now",()=>now);state.hours=false;
 const {runScheduledSophieCallbacks}=await import("../lib/ai/calls/run-scheduled-callbacks");
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,0);
 now=Number(state.rows.get("ai_scheduled_callbacks:"+retryId)!.scheduledAt);state.hours=true;
 await adminDb.runTransaction(tx=>{tx.set(callbackState("biz",key),{manualLeaseUntil:now+60000});return Promise.resolve();});
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,0);assert.equal(state.rows.get("ai_scheduled_callbacks:"+retryId)?.status,"SCHEDULED");
});

test("settling an invoice before retry time cancels the retry",async t=>{
 const {scheduleInvoiceNoAnswerRetry}=await import("../lib/ai/calls/invoice-no-answer-retry");
 const {adminDb}=await import("@/lib/firebase/admin");
 await adminDb.runTransaction(tx=>scheduleInvoiceNoAnswerRetry(tx,"biz","invoice-a",id));
 const retryId=attempt().noAnswerRetryId as string,now=Number(state.rows.get("ai_scheduled_callbacks:"+retryId)!.scheduledAt);
 t.mock.method(Date,"now",()=>now);invoice().status="paid";
 const {runScheduledSophieCallbacks}=await import("../lib/ai/calls/run-scheduled-callbacks");
 await runScheduledSophieCallbacks();assert.equal(state.rows.get("ai_scheduled_callbacks:"+retryId)?.status,"CANCELLED");assert.equal(state.dials.length,0);
});
