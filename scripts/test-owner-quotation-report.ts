import assert from "node:assert/strict";
import test from "node:test";
import type {Firestore} from "firebase-admin/firestore";
import {quotationFollowUpReport} from "../lib/ai/owner-call/quotation-follow-up-report";
type Row=Record<string,unknown>;
function fixture(){
 const rows=new Map<string,Row>(),queries:unknown[][]=[],reads:string[]=[];
 const snap=(name:string,id:string)=>{const data=rows.get(`${name}:${id}`);return {id,exists:!!data,data:()=>data,get:(key:string)=>data?.[key]};};
 const query=(name:string,filters:unknown[][]=[],max=Infinity,sort?:string)=>({
  where:(key:string,op:string,val:unknown)=>query(name,[...filters,[key,op,val]],max,sort),
  orderBy:(key:string)=>query(name,filters,max,key),limit:(count:number)=>query(name,filters,count,sort),doc:(id:string)=>({name,id}),
  get:async()=>{queries.push([name,...filters]);const found=[...rows].filter(([key,row])=>key.startsWith(name+":")&&filters.every(([field,,value])=>row[field as string]===value));
   if(sort)found.sort((a,b)=>Number(b[1][sort])-Number(a[1][sort]));const docs=found.slice(0,max).map(([key])=>snap(name,key.slice(name.length+1)));return {docs,size:docs.length};},
 });
 const db={collection:(name:string)=>query(name),getAll:async(...refs:{name:string;id:string}[])=>refs.map(ref=>{reads.push(`${ref.name}:${ref.id}`);return snap(ref.name,ref.id);})} as unknown as Firestore;
 const addQuote=(id:string,patch:Row={})=>rows.set(`quotations:${id}`,{businessId:"business-a",quotationCode:`QT ${id.toUpperCase()}`,status:"sent",createdAt:100,customer:{fullName:"Test Customer"},serviceTitle:"Inspection",finalPriceAud:110,...patch});
 return {rows,queries,reads,db,addQuote};
}
test("owner can read pending, accepted/rejected quotes and verified callback responses",async()=>{
 const f=fixture(),attemptId="a".repeat(64),callId="a1234567-1234-1234-1234-123456789abc";
 f.addQuote("accepted",{customerDecision:"accepted",sophieFollowUpEnabled:true,sophieFollowUpVersion:"v1",sophieFollowUpStatus:"DECIDED",sophieFollowUpCallId:attemptId});
 f.addQuote("pending");f.addQuote("rejected",{customerDecision:"rejected"});f.addQuote("foreign",{businessId:"business-b"});
 f.rows.set(`ai_quotation_followup_calls:${attemptId}`,{businessId:"business-a",quotationId:"accepted",version:"v1",did:"0359111403",numberKey:"412345678",status:"ANSWERED",decision:"accepted",attemptedAt:100,callLogId:callId});
 f.rows.set(`ai_call_logs:${callId}`,{businessId:"business-a",callbackAttemptId:attemptId,did:"0359111403",callerKey:"412345678",transcript:[{speaker:"sophie",text:"Can I help?"},{speaker:"caller",text:"Yes, I accept the quotation."}]});
 const pending=await quotationFollowUpReport(f.db,"business-a");assert.equal(pending.quotes.length,1);assert.equal(pending.quotes[0].reference,"QT PENDING");
 const report=await quotationFollowUpReport(f.db,"business-a",undefined,0,true);assert.equal(report.quotes.length,3);
 const accepted=report.quotes.find(quote=>quote.reference==="QT ACCEPTED")!;assert.equal(accepted.customerDecision,"accepted");assert.equal(accepted.followUp.recordedCallDecision,"accepted");assert.equal(accepted.followUp.matchesCurrentRevision,true);
 assert.deepEqual(accepted.followUp.customerResponse?.excerpts,["Yes, I accept the quotation."]);assert.equal(report.quotes.some(quote=>quote.reference==="QT FOREIGN"),false);
 for(const query of f.queries)assert.ok(query.some(filter=>Array.isArray(filter)&&filter[0]==="businessId"&&filter[2]==="business-a"));
});
test("wrong-tenant or wrong-call logs are unavailable, never customer responses",async()=>{
 const f=fixture(),id="b".repeat(64),callId="b1234567-1234-1234-1234-123456789abc";
 f.addQuote("one",{sophieFollowUpCallId:id,sophieFollowUpVersion:"current"});f.rows.set(`ai_quotation_followup_calls:${id}`,{businessId:"business-a",quotationId:"one",version:"old",did:"0359111403",numberKey:"412345678",callLogId:callId});
 f.rows.set(`ai_call_logs:${callId}`,{businessId:"business-b",transcript:[{speaker:"caller",text:"secret"}]});
 let result=await quotationFollowUpReport(f.db,"business-a",undefined,0,true);assert.equal(result.quotes[0].followUp.customerResponseAvailable,false);assert.equal(result.quotes[0].followUp.matchesCurrentRevision,false);assert.equal(JSON.stringify(result).includes("secret"),false);
 f.rows.set(`ai_call_logs:${callId}`,{businessId:"business-a",callbackAttemptId:"other",transcript:[{speaker:"caller",text:"wrong call"}]});result=await quotationFollowUpReport(f.db,"business-a",undefined,0,true);assert.equal(result.quotes[0].followUp.customerResponse,null);
 f.rows.get(`ai_quotation_followup_calls:${id}`)!.businessId="business-b";result=await quotationFollowUpReport(f.db,"business-a",undefined,0,true);assert.equal(result.quotes[0].followUp.callOutcome,null);
});
test("bounded scans report partial scope and exact QT lookup finds older quotations",async()=>{
 const f=fixture();for(let i=0;i<105;i++)f.addQuote(String(i),{createdAt:i});
 const result=await quotationFollowUpReport(f.db,"business-a",undefined,0,true);assert.equal(result.complete,false);assert.equal(result.quotes.length,10);assert.equal(result.totalInScope,100);assert.equal(result.nextOffset,10);
 const exact=await quotationFollowUpReport(f.db,"business-a","QT 0",0,true);assert.equal(exact.complete,true);assert.equal(exact.quotes[0].reference,"QT 0");
});
