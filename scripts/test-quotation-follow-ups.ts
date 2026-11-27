import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
// @ts-expect-error Runtime hooks are available in the test Node version.
import {registerHooks} from 'node:module';
import test,{beforeEach,after} from 'node:test';
import {quotationFollowUpFields,quotationFingerprint,quotationFollowUpEligible,quotationAttemptMatches,QUOTATION_FOLLOW_UP_CALLS} from '../lib/ai/calls/quotation-follow-up-policy';
import {QUOTATION_FOLLOW_UP_DELAY_MS} from '../lib/quotations/follow-up-timing';
type Row=Record<string,unknown>;
const state={rows:new Map<string,Row>(),dials:[] as Row[],optedOut:false,hours:true,busy:false,effects:0};
(globalThis as {__quoteFollowUp?:typeof state}).__quoteFollowUp=state;
const folder=mkdtempSync(join(tmpdir(),'quote-followup-'));
const fixtures={
 'lib/firebase/admin':`
 const s=globalThis.__quoteFollowUp;
 const value=(row,key)=>key.split('.').reduce((r,k)=>r?.[k],row);
 const doc=(name,id)=>({id,path:name+':'+id,get:async()=>snap(name,id),update:async patch=>update(name,id,patch),set:async patch=>s.rows.set(name+':'+id,{...s.rows.get(name+':'+id),...patch})});
 const update=(name,id,patch)=>{const row=s.rows.get(name+':'+id);if(!row)throw Error('Missing fixture');for(const [key,val] of Object.entries(patch)){const parts=key.split('.');let target=row;while(parts.length>1){const key=parts.shift();target=target[key]??={};}target[parts[0]]=val;}};
 const snap=(name,id)=>{const data=s.rows.get(name+':'+id);const saved=data?structuredClone(data):undefined;return {id,ref:doc(name,id),exists:!!data,data:()=>saved,get:key=>value(saved,key)}};
 const query=(name,filters=[],max=Infinity,order)=>({doc:id=>doc(name,id),where:(key,op,val)=>query(name,[...filters,[key,op,val]],max,order),limit:n=>query(name,filters,n,order),orderBy:key=>query(name,filters,max,key),get:async()=>{let rows=[...s.rows].filter(([key,row])=>key.startsWith(name+':')&&filters.every(([key,op,val])=>op==='=='?value(row,key)===val:op==='<='?value(row,key)<=val:false));if(order)rows.sort((a,b)=>value(a[1],order)-value(b[1],order));const docs=rows.slice(0,max).map(([key])=>snap(name,key.slice(name.length+1)));return {docs,size:docs.length}}});
 exports.adminDb={collection:name=>query(name),runTransaction:async fn=>{const writes=[];const result=await fn({get:ref=>ref.get(),create:(ref,data)=>writes.push(()=>{if(s.rows.has(ref.path))throw Error('duplicate');s.rows.set(ref.path,data)}),update:(ref,patch)=>writes.push(()=>{const [name,id]=ref.path.split(':');update(name,id,patch)}),set:(ref,data)=>writes.push(()=>s.rows.set(ref.path,{...s.rows.get(ref.path),...data})),delete:ref=>writes.push(()=>s.rows.delete(ref.path))});for(const write of writes)write();return result;}};`,
 'lib/onboarding/server':`exports.getBusinessProfile=async()=>({enabledModules:{quotations:true},timezone:'Australia/Melbourne'});`,
 'lib/ai/data/did-mappings':`exports.DID_MAPPINGS_COLLECTION='ai_did_mappings';exports.lookupVoiceDidRoute=async did=>({state:'active',binding:{businessId:'business-a',did},business:{ownerUid:'owner-a'},callback:{callerId:did}});`,
 'lib/ai/calls/call-preferences':`exports.isCustomerCallOptedOut=async()=>globalThis.__quoteFollowUp.optedOut;`,
 'lib/ai/calls/calling-hours':`exports.isWithinSophieCallingHours=()=>globalThis.__quoteFollowUp.hours;`,
 'lib/ai/calls/request-callback':`exports.requestSophieCallback=async input=>{const s=globalThis.__quoteFollowUp;s.dials.push(input);return s.busy?new Response(null,{status:429}):Response.json({status:'ANSWERED'})};`,
 'lib/ai/mcp/tools/invoice.tools':`exports.draftAcceptedQuotationInvoice=async()=>{globalThis.__quoteFollowUp.effects++;return {status:'DRAFTED'}};`,
 'lib/notifications/realtime-hub':`exports.notifyBusinessNotificationsChanged=()=>{};`,
 'lib/notifications/push':`exports.resolveBusinessOwnerUid=async()=>null;exports.sendOwnerMobilePush=async()=>{};`,
};
const paths=new Map<string,string>();for(const [key,source] of Object.entries(fixtures)){const path=join(folder,key.replaceAll('/','-')+'.cjs');writeFileSync(path,source);paths.set(key,pathToFileURL(path).href);}
const hook=registerHooks({resolve(specifier:string,context:unknown,nextResolve:(specifier:string,context:unknown)=>unknown){let key=specifier.startsWith('@/')?specifier.slice(2):null;if(specifier.startsWith('./')&&typeof (context as {parentURL?:string}).parentURL==='string'){const parent=(context as {parentURL:string}).parentURL;if(parent.includes('/lib/ai/calls/'))key='lib/ai/calls/'+specifier.slice(2);}if(key&&paths.has(key))return {url:paths.get(key),shortCircuit:true};return nextResolve(specifier,context);}});
after(()=>{hook.deregister();rmSync(folder,{recursive:true,force:true});});
const now=Date.now(),binding={businessId:'business-a',did:'0359111403'};
function quote(){return {...quotationFollowUpFields(true,true,Date.now()-QUOTATION_FOLLOW_UP_DELAY_MS-60000),businessId:'business-a',inspectionRequestId:'request-a',quotationCode:'QT TEST123',status:'sent',serviceTitle:'Install a light',lineItems:[{name:'Labour',priceAud:100}],customer:{fullName:'Customer Fixture',email:'customer@example.test',phone:'0412345678'},address:{street:'1 Test St'},finalPriceAud:110,subtotalAud:100,gstPricing:'exclusive',validUntil:'2099-12-31'};}
beforeEach(()=>{state.rows.clear();state.dials=[];state.optedOut=false;state.hours=true;state.busy=false;state.effects=0;process.env.AI_SOPHIE_CALLBACK_ENABLED='true';process.env.AI_SOPHIE_QUOTATION_CALLS_ENABLED='true';process.env.AI_VOICE_CALL_LOGS_ENABLED='true';const q=quote();state.rows.set('quotations:quote-a',q);state.rows.set('businesses:business-a',{ownerUid:'owner-a',isActive:true,timezone:'Australia/Melbourne'});state.rows.set('requests:request-a',{businessId:'business-a',status:'awaiting_decision',quotation:{id:'quote-a'}});state.rows.set('ai_did_mappings:0359111403',{businessId:'business-a',isActive:true,callback:{callerId:'0359111403',automatic:true}});});
async function dial(){const {runQuotationFollowUps}=await import('../lib/ai/calls/run-quotation-follow-ups');await runQuotationFollowUps();return String(state.dials[0]?.id);}
test('quotation follow-up uses the configured temporary delay after sending; drafts, disabled and decided quotes are excluded',()=>{
 const q=quote();assert.equal(quotationFollowUpEligible(q,'Australia/Melbourne'),true);
 const early={...q,...quotationFollowUpFields(true,true,now)};assert.equal(early.sophieFollowUpDueAt,now+QUOTATION_FOLLOW_UP_DELAY_MS);assert.equal(quotationFollowUpEligible(early,'Australia/Melbourne',now+QUOTATION_FOLLOW_UP_DELAY_MS-1),false);assert.equal(quotationFollowUpEligible(early,'Australia/Melbourne',now+QUOTATION_FOLLOW_UP_DELAY_MS),true);
 for(const update of [{sophieFollowUpEnabled:false},{status:'draft'},{status:'cancelled'},{customerDecision:'accepted'},{customerDecision:'rejected'},{bookingId:'job-a'},{invoiceId:'invoice-a'},{validUntil:'2020-01-01'}])assert.equal(quotationFollowUpEligible({...q,...update},'Australia/Melbourne'),false);
 assert.equal(quotationFollowUpFields(true,false).sophieFollowUpStatus,'DISABLED');
});
test('saved due time survives changing test delays without premature calls or skips',()=>{
 const q=quote(),sent=Date.now()-90000;
 const saved={...q,sophieFollowUpSentAt:sent,sophieFollowUpDueAt:sent+120000};
 assert.equal(quotationFollowUpEligible(saved,'Australia/Melbourne',sent+90000),false);
 assert.equal(quotationFollowUpEligible(saved,'Australia/Melbourne',sent+120000),true);
 const accelerated={...q,sophieFollowUpSentAt:Date.now()-30000,sophieFollowUpDueAt:Date.now()-1000};
 assert.equal(quotationFollowUpEligible(accelerated,'Australia/Melbourne'),true);
});
test('one due quotation is dialled once and only on the quotation endpoint payload',async()=>{
 const id=await dial();assert.equal(state.dials.length,1);assert.deepEqual(state.dials[0].quotationFollowUp,{quotationCode:'QT TEST123'});assert.equal(state.rows.get(QUOTATION_FOLLOW_UP_CALLS+':'+id)?.status,'ANSWERED');
 await dial();assert.equal(state.dials.length,1);
});
test('feature flags, calling hours, opt-outs and expired quotes prevent dialing',async()=>{
 const {runQuotationFollowUps}=await import('../lib/ai/calls/run-quotation-follow-ups');
 process.env.AI_SOPHIE_QUOTATION_CALLS_ENABLED='false';await runQuotationFollowUps();assert.equal(state.dials.length,0);process.env.AI_SOPHIE_QUOTATION_CALLS_ENABLED='true';
 state.hours=false;await runQuotationFollowUps();assert.equal(state.dials.length,0);state.hours=true;state.optedOut=true;await runQuotationFollowUps();assert.equal(state.dials.length,0);assert.equal(state.rows.get('quotations:quote-a')?.sophieFollowUpStatus,'SKIPPED');
});
test('bridge busy is deferred, but answered/no-answer calls are not blindly retried',async()=>{
 const {runQuotationFollowUps}=await import('../lib/ai/calls/run-quotation-follow-ups');state.busy=true;await runQuotationFollowUps();assert.equal(state.rows.get('quotations:quote-a')?.sophieFollowUpStatus,'QUEUED');assert.equal([...state.rows.keys()].some(key=>key.startsWith(QUOTATION_FOLLOW_UP_CALLS+':')),false);
});
test('details and confirmed decisions stay bound to tenant, recipient and exact quote version',async()=>{
 const id=await dial(),{readFollowUpQuotation,recordFollowUpQuotationDecision,completeQuotationDecisionEffects}=await import('../lib/ai/calls/quotation-follow-up-actions');
 assert.equal((await readFollowUpQuotation({...binding,businessId:'other'},id,'0412345678')).status,'UNAVAILABLE');
 assert.equal((await readFollowUpQuotation(binding,id,'0412345679')).status,'UNAVAILABLE');
 assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','accepted')).status,'REJECTED');
 const details=await readFollowUpQuotation(binding,id,'0412345678');assert.equal(details.status,'OK');assert.equal(details.quotation?.totalAud,110);
 assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','accepted')).status,'RECORDED');assert.equal(state.rows.get('quotations:quote-a')?.customerDecision,'accepted');assert.equal((state.rows.get('requests:request-a')?.quotation as Row).customerDecision,'accepted');
 assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','rejected')).status,'REJECTED');
 assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','accepted')).status,'RECORDED');
 await completeQuotationDecisionEffects(id);await completeQuotationDecisionEffects(id);assert.equal(state.effects,1);assert.equal([...state.rows.keys()].filter(key=>key.startsWith('business_notifications:')).length,1);
});
test('rejection notifies owner atomically without accepting or drafting an invoice',async()=>{
 const id=await dial(),{readFollowUpQuotation,recordFollowUpQuotationDecision,completeQuotationDecisionEffects}=await import('../lib/ai/calls/quotation-follow-up-actions');await readFollowUpQuotation(binding,id,'0412345678');assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','rejected')).status,'RECORDED');await completeQuotationDecisionEffects(id);assert.equal(state.effects,0);assert.equal(state.rows.get('business_notifications:quotation-followup-'+id)?.type,'quotation_rejected');
});
test('price changes, portal decisions and finalized calls cannot be overwritten',async()=>{
 const id=await dial(),{readFollowUpQuotation,recordFollowUpQuotationDecision}=await import('../lib/ai/calls/quotation-follow-up-actions');await readFollowUpQuotation(binding,id,'0412345678');const q=state.rows.get('quotations:quote-a')!;
 q.finalPriceAud=120;assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','accepted')).status,'UNAVAILABLE');q.finalPriceAud=110;q.customerDecision='rejected';assert.equal((await recordFollowUpQuotationDecision(binding,id,'0412345678','accepted')).status,'UNAVAILABLE');delete q.customerDecision;state.rows.get(QUOTATION_FOLLOW_UP_CALLS+':'+id)!.callLogId='ended';assert.equal((await readFollowUpQuotation(binding,id,'0412345678')).status,'UNAVAILABLE');
});
test('fingerprints ignore map key order and call metadata but detect commercial changes',()=>{
 const q=quote(),same={...q,customer:{phone:q.customer.phone,email:q.customer.email,fullName:q.customer.fullName},updatedAt:999};assert.equal(quotationFingerprint(q),quotationFingerprint(same));assert.notEqual(quotationFingerprint(q),quotationFingerprint({...q,finalPriceAud:111}));
 assert.equal(quotationAttemptMatches({businessId:binding.businessId,did:binding.did,number:null,status:'ANSWERED',attemptedAt:Date.now(),version:q.sophieFollowUpVersion,fingerprint:quotationFingerprint(q)},q,binding,null),false);
});
