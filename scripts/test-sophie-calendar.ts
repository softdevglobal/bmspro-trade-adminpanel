import assert from "node:assert/strict";
import {test} from "node:test";
import type {Firestore} from "firebase-admin/firestore";
import {scheduledSophieItem,quotationSophieItem,invoiceSophieItem} from "../lib/calendar/sophie-events";
import {loadSophieCalendar} from "../lib/calendar/sophie-events.server";
import {buildMonthGridCalendarEvents,calendarEventSummary,emptyCalendarFilters,calendarEventTimeRange} from "../lib/calendar/events";

const TZ="Australia/Melbourne";
const at=Date.parse("2026-11-25T23:30:00Z");
test("scheduled calls use the business date, preserve status and hide full numbers",()=>{
 const item=scheduledSophieItem("a",{scheduledAt:at,status:"OWNER_NUMBER_SCHEDULED",number:"+94776654216",instructions:"Ask about the service"},TZ)!;
 assert.equal(item.date,"2026-11-26");assert.equal(item.time,"10:30");assert.equal(item.statusLabel,"Scheduled");
 assert.equal(item.recipient,"Number ending 4216");assert.equal(item.reason,"Ask about the service");
 assert.match(item.href,/view=scheduled&date=2026-11-26/);
});
test("quotation follow-ups require opt-in and a valid saved time",()=>{
 assert.equal(quotationSophieItem("q",{sophieFollowUpDueAt:at},TZ),null);
 assert.equal(quotationSophieItem("q",{sophieFollowUpEnabled:true,sophieFollowUpDueAt:NaN},TZ),null);
 const item=quotationSophieItem("q",{sophieFollowUpEnabled:true,sophieFollowUpDueAt:at,sophieFollowUpStatus:"QUEUED",customerDecision:"accepted",customer:{fullName:"Sam"},quotationCode:"QT-1"},TZ)!;
 assert.equal(item.status,"SKIPPED");assert.equal(item.reference,"QT-1");assert.equal(item.recipient,"Sam");
});
test("invoice callbacks have one calendar entry even after a scheduled attempt finishes",()=>{
 assert.equal(invoiceSophieItem("i",{status:"SCHEDULED",attemptedAt:at},TZ),null);
 assert.equal(invoiceSophieItem("i",{status:"ANSWERED",source:"scheduled",attemptedAt:at},TZ),null);
 assert.equal(invoiceSophieItem("i",{status:"ANSWERED",scheduledAt:at,attemptedAt:at},TZ),null);
 assert.equal(scheduledSophieItem("i",{purpose:"overdue_invoice",scheduledAt:at,status:"ANSWERED"},TZ)?.kind,"invoice_follow_up");
 assert.equal(invoiceSophieItem("i",{status:"QUEUED",attemptedAt:at},TZ)?.timing,"queued");
});
test("Sophie activities appear on the calendar without reserving visit capacity",()=>{
 const item=scheduledSophieItem("a",{scheduledAt:at,status:"SCHEDULED",customerName:"Sam"},TZ)!;
 const [event]=buildMonthGridCalendarEvents([],emptyCalendarFilters(null),[],[],[],[item]);
 assert.equal(event.source,"sophie");assert.equal(event.dotColor,"sky-500");assert.equal(calendarEventTimeRange(event),null);
 assert.match(calendarEventSummary(event),/10:30.*Scheduled calls.*Sam.*Scheduled/);
});

type Row=Record<string,unknown>;
function fakeDb(rows:Record<string,Row[]>){
 const queries:{name:string;clauses:unknown[][];limit?:number;order?:unknown[]}[]=[];
 const doc=(row:Row,index:number)=>({id:String(row.id??index),data:()=>row,get:(key:string)=>row[key],exists:true});
 const db={collection(name:string){
  const log:{name:string;clauses:unknown[][];limit?:number;order?:unknown[]}={name,clauses:[]};
  const query={where(...clause:unknown[]){log.clauses.push(clause);return query;},orderBy(...order:unknown[]){log.order=order;return query;},limit(limit:number){log.limit=limit;return query;},async get(){queries.push(log);const docs=(rows[name]??[]).map(doc);return {docs,size:docs.length};},doc(id:string){return {id,name};}};
  return query;
 },async getAll(...refs:{id:string;name:string}[]){return refs.flatMap(ref=>(rows[ref.name]??[]).filter(row=>row.id===ref.id).map(doc));}};
 return {db:db as unknown as Firestore,queries};
}
test("loader bounds every query to tenant and visible dates and omits foreign records",async()=>{
 const {db,queries}=fakeDb({
  ai_scheduled_callbacks:[{id:"s",businessId:"biz",scheduledAt:at,status:"SCHEDULED"},{businessId:"other",scheduledAt:at}],
  quotations:[{businessId:"biz",sophieFollowUpEnabled:true,sophieFollowUpDueAt:at,sophieFollowUpStatus:"QUEUED"}],
  ai_invoice_call_attempts:[{businessId:"biz",invoiceId:"i",attemptedAt:at,status:"QUEUED"},{businessId:"biz",invoiceId:"foreign",attemptedAt:at},{businessId:"biz",invoiceId:"bad/path",attemptedAt:at}],
  invoices:[{id:"i",businessId:"biz",invoiceCode:"INV-1",customer:{fullName:"Sam"}},{id:"foreign",businessId:"other"}],
 });
 const result=await loadSophieCalendar(db,"biz",at-1000,at+1000,TZ,{invoices:true,quotations:true});
 assert.equal(result.items.length,3);assert.equal(result.partial,false);
 for(const query of queries){assert.deepEqual(query.clauses[0],["businessId","==","biz"]);assert.equal(query.clauses[1][1],">=");assert.equal(query.clauses[2][1],"<");assert.equal(query.limit,101);}
 assert.equal(result.items.find(item=>item.kind==="invoice_follow_up")?.reference,"INV-1");
});
test("disabled modules are not queried, and scheduled invoice callbacks stay hidden",async()=>{
 const {db,queries}=fakeDb({ai_scheduled_callbacks:[{businessId:"biz",purpose:"overdue_invoice",scheduledAt:at}]});
 const result=await loadSophieCalendar(db,"biz",at-1,at+1,TZ,{invoices:false,quotations:false});
 assert.equal(result.items.length,0);assert.deepEqual(queries.map(query=>query.name),["ai_scheduled_callbacks"]);
});
test("large ranges are capped and reported as partial",async()=>{
 const {db}=fakeDb({ai_scheduled_callbacks:Array.from({length:101},(_,id)=>({id,businessId:"biz",scheduledAt:at,status:"SCHEDULED"}))});
 const result=await loadSophieCalendar(db,"biz",at-1,at+1,TZ,{invoices:false,quotations:false});
 assert.equal(result.partial,true);assert.equal(result.items.length,100);
});
