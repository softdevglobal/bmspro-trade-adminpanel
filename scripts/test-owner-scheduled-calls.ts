import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
// @ts-expect-error Test runtime supports hooks; application typings target Node 20.
import {registerHooks} from 'node:module';
import test,{beforeEach,after} from 'node:test';
import {platformTodayIso} from '../lib/platform/timezone';
import {OWNER_PREPARE_TOOL_NAMES} from '../lib/ai/owner-call/owner-actions';
import {ownerScheduledCallsEnabled} from '../lib/ai/owner-call/owner-scheduled-calls';

type Row=Record<string,unknown>;
const state={rows:new Map<string,Row>(),writes:0,optedOut:false,hours:true,busy:false,dials:[] as Row[],savedLogs:new Map<string,Row>()};
(globalThis as {__scheduled?:typeof state}).__scheduled=state;
const folder=mkdtempSync(join(tmpdir(),'owner-scheduled-'));
const fixtures={
 'lib/firebase/admin':`
 const f=globalThis.__scheduled;
 const doc=(name,id)=>({id,path:name+':'+id,get:async()=>snap(name,id),create:async data=>{if(f.rows.has(name+':'+id))throw {code:6};f.rows.set(name+':'+id,data);f.writes++},update:async data=>{Object.assign(f.rows.get(name+':'+id),data);f.writes++},set:async(data)=>{f.rows.set(name+':'+id,{...f.rows.get(name+':'+id),...data});f.writes++}});
 const snap=(name,id)=>{const data=f.rows.get(name+':'+id);return {id,ref:doc(name,id),exists:!!data,data:()=>data,get:key=>data?.[key],updateTime:{seconds:1000,nanoseconds:Number(data?.revision??1)}}};
 const query=(name,filters=[],max=Infinity)=>({where:(key,op,value)=>query(name,[...filters,[key,op,value]],max),limit:value=>query(name,filters,value),doc:id=>doc(name,id),get:async()=>{const docs=[...f.rows].filter(([key,row])=>key.startsWith(name+':')&&filters.every(([field,op,value])=>row[field]===value)).slice(0,max).map(([key])=>snap(name,key.slice(name.length+1)));return {docs,size:docs.length}}});
 exports.adminDb={collection:name=>query(name),runTransaction:async fn=>fn({get:ref=>ref.get(),create:(ref,data)=>ref.create(data),update:(ref,data)=>ref.update(data),set:(ref,data)=>ref.set(data)})};`,
 'lib/ai/data/did-mappings':`exports.lookupVoiceDidRoute=async did=>{const f=globalThis.__scheduled;return {state:'active',binding:{businessId:'business-a',did},business:{ownerUid:'owner-a',timezone:'Australia/Melbourne'},callback:{callerId:did,dialPrefix:''}}};`,
 'lib/ai/calls/call-preferences':`exports.isCustomerCallOptedOut=async()=>globalThis.__scheduled.optedOut;exports.setCustomerCallOptOut=async()=>{globalThis.__scheduled.optedOut=true};`,
 'lib/ai/calls/calling-hours':`exports.isWithinSophieCallingHours=()=>globalThis.__scheduled.hours;`,
 'lib/ai/config':`exports.authenticateVoiceBridgeCredential=request=>request.headers.get('authorization')==='Bearer bridge-fixture'?{ok:true,did:'0359111403'}:{ok:false,status:401};exports.authenticateVoiceBridge=request=>request.headers.get('authorization')==='Bearer bridge-fixture'?{ok:true,binding:{businessId:'business-a',did:'0359111403'}}:{ok:false,status:401};`,
 'lib/onboarding/services/server':`exports.requireBusinessOwner=async request=>request.headers.get('authorization')==='Bearer owner'?{ok:true,businessId:'business-a'}:{ok:false,status:403,error:'Owner required'};`,
 'lib/onboarding/server':`exports.getBusinessProfile=async()=>({timezone:'Australia/Melbourne'});`,
 'lib/ai/calls/due-scheduled-callbacks':`exports.loadDueScheduledCallbacks=async db=>(await db.collection('ai_scheduled_callbacks').where('status','==','SCHEDULED').get()).docs;`,
 'lib/ai/calls/request-callback':`exports.requestSophieCallback=async input=>{globalThis.__scheduled.dials.push(input);return globalThis.__scheduled.busy?new Response(null,{status:429}):Response.json({status:'ANSWERED'})};`,
 'lib/ai/calls/invoice-call-history':`exports.INVOICE_CALL_ATTEMPTS_COLLECTION='ai_invoice_call_attempts';`,
 'lib/invoices/server':`exports.INVOICE_COLLECTION='invoices';exports.mapInvoiceDoc=()=>null;`,
 'lib/ai/calls/callback-state':`exports.callbackResultStatus=value=>value;exports.saveCallbackAttempt=async()=>{};exports.resolveCallback=async()=>{};exports.callbackState=()=>({get:async()=>({data:()=>({})})});exports.readCallbackAttempts=()=>[];`,
};
const paths=new Map(Object.entries(fixtures).map(([key,source],i)=>{const file=join(folder,`${i}.cjs`);writeFileSync(file,source);return ['@/'+key,pathToFileURL(file).href]}));
const hooks=registerHooks({resolve(s:string,c:unknown,next:(s:string,c:unknown)=>unknown){const key=s.startsWith('./')&&(c as {parentURL?:string}).parentURL?.includes('/lib/ai/calls/')?'@/lib/ai/calls/'+s.slice(2):s;const url=paths.get(key);return url?{url,format:'commonjs',shortCircuit:true}:next(s,c)}});
after(()=>{hooks.deregister();rmSync(folder,{recursive:true,force:true})});
beforeEach(()=>{
 state.rows.clear();state.writes=0;state.optedOut=false;state.hours=true;state.busy=false;state.dials=[];
 process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED='true';process.env.AI_SOPHIE_CALLBACK_ENABLED='true';delete process.env.AI_VOICE_CALL_LOGS_ENABLED;
 state.rows.set('customers:customer-a',{registeredBusinessId:'business-a',fullName:'John Smith',email:'john@example.test',phone:'0412345678'});
 state.rows.set('ai_did_mappings:0359111403',{businessId:'business-a',isActive:true,did:'0359111403'});
});
const owner={businessId:'business-a',uid:'owner-a',timezone:'Australia/Melbourne',authorization:'Bearer owner'};
const args=()=>({customerName:'John Smith',date:platformTodayIso(new Date(Date.now()+86400000),'Australia/Melbourne'),time:'10:00',category:'complaint',instructions:'Ask whether the repair resolved the issue and what still needs attention.'});

test('owner scheduling is opt-in and uses the existing confirmation gate',()=>{
 assert.equal(ownerScheduledCallsEnabled({}),false);assert.ok(OWNER_PREPARE_TOOL_NAMES.includes('prepare_customer_scheduled_call'));
});
test('prepare does not create a call; confirmation saves the customer, purpose, time and owner',async()=>{
 const {prepareOwnerScheduledCall,confirmOwnerScheduledCall}=await import('../lib/ai/mcp/tools/owner-scheduled-calls.tools');
 const p=await prepareOwnerScheduledCall(owner,args());assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;
 assert.equal(state.writes,0);assert.match(p.summary,/complaint/);assert.match(p.summary,/resolved the issue/);
 assert.equal((await confirmOwnerScheduledCall(owner,p.payload)).status,'DONE');assert.equal(state.dials.length,0);
 const saved=state.rows.get('ai_scheduled_callbacks:'+p.payload.id)!;
 assert.equal(saved.purpose,'owner_requested');assert.equal(saved.instructions,args().instructions);assert.equal(saved.requestedBy,'owner-a');assert.equal(saved.numberKey,'412345678');
});
test('ambiguous customers, foreign customers, past dates, missing purpose, off-hours and opt-outs are refused',async()=>{
 const {prepareOwnerScheduledCall}=await import('../lib/ai/mcp/tools/owner-scheduled-calls.tools');
 for(const patch of [{date:'2020-01-01'},{date:'2099-01-01'},{instructions:''},{number:'0411111111'},{businessId:'other'}])assert.equal((await prepareOwnerScheduledCall(owner,{...args(),...patch})).ok,false);
 assert.equal((await prepareOwnerScheduledCall({...owner,businessId:'foreign'},args())).ok,false);
 state.rows.set('customers:duplicate',{...state.rows.get('customers:customer-a')!,email:'other@example.test'});
 assert.equal((await prepareOwnerScheduledCall(owner,args())).ok,false);
 assert.equal((await prepareOwnerScheduledCall(owner,{...args(),customerEmail:'john@example.test'})).ok,true);
 state.rows.delete('customers:duplicate');state.optedOut=true;assert.equal((await prepareOwnerScheduledCall(owner,args())).ok,false);
 state.optedOut=false;state.hours=false;assert.equal((await prepareOwnerScheduledCall(owner,args())).ok,false);
 assert.equal(state.writes,0);
});
test('changed contacts and new opt-outs are rechecked before the schedule is saved',async()=>{
 const {prepareOwnerScheduledCall,confirmOwnerScheduledCall}=await import('../lib/ai/mcp/tools/owner-scheduled-calls.tools');
 const p=await prepareOwnerScheduledCall(owner,args());assert.equal(p.ok,true);if(!p.ok)return;
 state.rows.get('customers:customer-a')!.revision=2;
 assert.equal((await confirmOwnerScheduledCall(owner,p.payload)).status,'REJECTED');state.rows.get('customers:customer-a')!.revision=1;
 state.optedOut=true;assert.equal((await confirmOwnerScheduledCall(owner,p.payload)).status,'REJECTED');assert.equal(state.writes,0);
});
async function dueCall(){
 const {prepareOwnerScheduledCall,confirmOwnerScheduledCall}=await import('../lib/ai/mcp/tools/owner-scheduled-calls.tools');
 const p=await prepareOwnerScheduledCall(owner,args());assert.equal(p.ok,true);if(!p.ok)throw Error('fixture preparation failed');
 await confirmOwnerScheduledCall(owner,p.payload);
 const row=state.rows.get('ai_scheduled_callbacks:'+p.payload.id)!;row.scheduledAt=Date.now()-1000;return row;
}
test('due owner call forwards the exact purpose to the bridge and is not dialled twice',async()=>{
 const row=await dueCall();const {runScheduledSophieCallbacks}=await import('../lib/ai/calls/run-scheduled-callbacks');
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,1);assert.equal(state.dials[0].customerName,'John Smith');assert.deepEqual(state.dials[0].ownerRequest,{category:'complaint',instructions:args().instructions});assert.equal(row.status,'ANSWERED');
 await runScheduledSophieCallbacks();assert.equal(state.dials.length,1);
});
test('due owner calls cancel on changed customer or opt-out; busy bridge defers safely',async()=>{
 const row=await dueCall();const {runScheduledSophieCallbacks}=await import('../lib/ai/calls/run-scheduled-callbacks');
 state.rows.get('customers:customer-a')!.phone='0411111111';await runScheduledSophieCallbacks();assert.equal(row.status,'CANCELLED');assert.equal(state.dials.length,0);
 state.rows.get('customers:customer-a')!.phone='0412345678';row.status='SCHEDULED';state.optedOut=true;await runScheduledSophieCallbacks();assert.equal(row.status,'CANCELLED');assert.equal(state.dials.length,0);
 state.optedOut=false;row.status='SCHEDULED';state.busy=true;const result=await runScheduledSophieCallbacks({busyRetryMs:30000});assert.equal(result.deferred,1);assert.equal(row.status,'SCHEDULED');assert.ok(Number(row.scheduledAt)>Date.now());
});
test('owner calls never run when logs or the owner feature are disabled, or the window expired',async()=>{
 const row=await dueCall();const {runScheduledSophieCallbacks}=await import('../lib/ai/calls/run-scheduled-callbacks');
 process.env.AI_VOICE_CALL_LOGS_ENABLED='false';await runScheduledSophieCallbacks();assert.equal(row.status,'CANCELLED');delete process.env.AI_VOICE_CALL_LOGS_ENABLED;
 row.status='SCHEDULED';process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED='false';await runScheduledSophieCallbacks();assert.equal(row.status,'CANCELLED');process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED='true';
 row.status='SCHEDULED';row.expiresAt=Date.now()-1;await runScheduledSophieCallbacks();assert.equal(row.status,'CANCELLED');assert.equal(state.dials.length,0);
});
test('owner-call transcripts are linked only to the same tenant, DID and customer phone; duplicate logs repair links',async()=>{
 const {saveCallLog}=await import('../lib/ai/calls/call-log');const row=await dueCall();const id=[...state.rows].find(([key])=>key.startsWith('ai_scheduled_callbacks:'))![0].split(':')[1];
 const input={callId:'0a41e31d-0620-47d1-9ef9-c9c60cef73a8',startedAt:new Date().toISOString(),answeredAt:new Date().toISOString(),endedAt:new Date().toISOString(),durationMs:1000,setupMs:100,endReason:'hangup',callerNumber:'0412345678',callbackAttemptId:id,ownerScheduledCall:true as const,tools:[],outcomes:[],transcript:[{speaker:'caller' as const,atMs:0,text:'The repair is good now.'}]};
 await saveCallLog({businessId:'foreign',did:'0359111403'},input);assert.equal(row.callLogId,undefined);
 input.callId='1a41e31d-0620-47d1-9ef9-c9c60cef73a8';
 await saveCallLog({businessId:'business-a',did:'0359111403'},input);assert.equal(row.callLogId,input.callId);
 delete row.callLogId;
 assert.equal(await saveCallLog({businessId:'business-a',did:'0359111403'},input),false);assert.equal(row.callLogId,input.callId);
 const saved=state.rows.get('ai_call_logs:'+input.callId)!;assert.deepEqual(saved.transcript,input.transcript);assert.equal(row.transcript,undefined);
});

test('a customer asking to call later keeps the owner purpose; an explicit stop request is recorded',async()=>{
 const row=await dueCall();const id=[...state.rows].find(([key])=>key.startsWith('ai_scheduled_callbacks:'))![0].split(':')[1];row.status='ANSWERED';
 const {POST:schedule}=await import('../app/api/ai/callbacks/schedule/route');
 const {POST:optOut}=await import('../app/api/ai/callbacks/opt-out/route');
 const scheduledAt=new Date(Number(row.originalScheduledAt)+3600000).toISOString();
 const request=(body:Row)=>new Request('http://localhost',{method:'POST',headers:{Authorization:'Bearer bridge-fixture','Content-Type':'application/json','X-BMSPro-Trade-Business':'business-a'},body:JSON.stringify(body)});
 const response=await schedule(request({callbackAttemptId:id,number:'0412345678',scheduledAt}));assert.equal(response.status,200);assert.equal((await response.json()).status,'SCHEDULED');
 const followup=[...state.rows].filter(([key])=>key.startsWith('ai_scheduled_callbacks:')&&key!=='ai_scheduled_callbacks:'+id).map(([,value])=>value)[0];
 assert.equal(followup.purpose,'owner_requested');assert.equal(followup.instructions,args().instructions);assert.equal(followup.customerId,'customer-a');
 const repeated=await schedule(request({callbackAttemptId:id,number:'0412345678',scheduledAt}));assert.equal((await repeated.json()).status,'ALREADY_SCHEDULED');
 const stopped=await optOut(request({callbackAttemptId:id,number:'0412345678',callDirection:'outbound',customerConfirmed:true}));assert.equal(stopped.status,200);assert.equal((await stopped.json()).status,'RECORDED');assert.equal(state.optedOut,true);
});
test('foreign attempts cannot schedule or opt out a customer; cancellation only affects unclaimed owner calls',async()=>{
 const row=await dueCall();const id=[...state.rows].find(([key])=>key.startsWith('ai_scheduled_callbacks:'))![0].split(':')[1];
 const bridgeRequest=(body:Row)=>new Request('http://localhost',{method:'POST',headers:{Authorization:'Bearer bridge-fixture','Content-Type':'application/json'},body:JSON.stringify(body)});
 const {POST:schedule}=await import('../app/api/ai/callbacks/schedule/route');const {POST:optOut}=await import('../app/api/ai/callbacks/opt-out/route');
 row.status='ANSWERED';row.businessId='foreign';
 assert.equal((await schedule(bridgeRequest({callbackAttemptId:id,number:'0412345678',scheduledAt:new Date(Number(row.originalScheduledAt)+3600000).toISOString()}))).status,403);
 assert.equal((await optOut(bridgeRequest({callbackAttemptId:id,number:'0412345678',callDirection:'outbound',customerConfirmed:true}))).status,403);assert.equal(state.optedOut,false);
 row.businessId='business-a';row.status='SCHEDULED';
 const {PATCH}=await import('../app/api/business/scheduled-callbacks/route');
 const request=(authorization='Bearer owner')=>new Request('http://localhost',{method:'PATCH',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({id,action:'cancel'})});
 assert.equal((await PATCH(request('Bearer staff'))).status,403);
 row.businessId='foreign';assert.equal((await PATCH(request())).status,404);row.businessId='business-a';
 row.status='CALLING';assert.equal((await PATCH(request())).status,409);row.status='SCHEDULED';assert.equal((await PATCH(request())).status,200);assert.equal(row.status,'CANCELLED');
});

test('the callback client selects distinct owner, invoice and missed-call bridge endpoints',async(t)=>{
 const {requestSophieCallback}=await import('../lib/ai/calls/request-callback');
 const previousUrl=process.env.AI_OWNER_VOICE_BRIDGE_URL,previousSecret=process.env.AI_VOICE_BRIDGE_SECRET;
 process.env.AI_OWNER_VOICE_BRIDGE_URL='http://127.0.0.1:8787';process.env.AI_VOICE_BRIDGE_SECRET='fixture-bridge-secret-for-callback-client-12345678';
 t.after(()=>{if(previousUrl===undefined)delete process.env.AI_OWNER_VOICE_BRIDGE_URL;else process.env.AI_OWNER_VOICE_BRIDGE_URL=previousUrl;if(previousSecret===undefined)delete process.env.AI_VOICE_BRIDGE_SECRET;else process.env.AI_VOICE_BRIDGE_SECRET=previousSecret});
 const paths:string[]=[];t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{paths.push(url.pathname);assert.equal(init.method,'POST');return Response.json({status:'ANSWERED'})});
 const base={id:'a'.repeat(64),did:'0359111403',businessId:'business-a',number:'0412345678'};
 await requestSophieCallback({...base,customerName:'John Smith',ownerRequest:{category:'invoice',instructions:'Ask whether the customer received the invoice.'}});
 await requestSophieCallback({...base,customerName:'John Smith'});await requestSophieCallback(base);
 assert.deepEqual(paths,['/sophie-owner-call','/sophie-invoice-call','/sophie-callback']);
});
