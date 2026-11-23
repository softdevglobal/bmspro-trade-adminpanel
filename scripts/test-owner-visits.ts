import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
// @ts-expect-error Runtime supports module hooks; project typings target Node 20.
import {registerHooks} from "node:module";
import test,{after,beforeEach} from "node:test";
import {Timestamp} from "firebase-admin/firestore";
import {visitActionBlock, ownerVisitsEnabled} from "../lib/ai/owner-call/owner-visits";
import {updateVisitVersioned} from "../lib/scheduling/visit-version";
import {checkPendingChange, OWNER_PREPARE_TOOL_NAMES} from "../lib/ai/owner-call/owner-actions";

type Row = Record<string, unknown>;
const state = {rows: new Map<string, Row>(), writes: 0, last: null as Row | null, createFailure: false, full: false};
(globalThis as {__visits?: typeof state}).__visits = state;
const folder = mkdtempSync(join(tmpdir(),"owner-visits-"));
const sources = {
 "lib/firebase/admin": `
 const state=globalThis.__visits;
 const snap=(key,data)=>({id:key.split(':')[1],exists:!!data,data:()=>data,updateTime:{seconds:1000,nanoseconds:Number(data?.revision??1)},get:field=>data?.[field]});
 const query=(name,filters=[],max=Infinity)=>({
   where:(field,op,value)=>query(name,[...filters,[field,value]],max),limit:value=>query(name,filters,value),
   doc:id=>({get:async()=>snap(name+':'+id,state.rows.get(name+':'+id))}),
   get:async()=>{const docs=[...state.rows].filter(([key,data])=>key.startsWith(name+':')&&filters.every(([field,value])=>field.split('.').reduce((row,key)=>row?.[key],data)===value)).slice(0,max).map(([key,data])=>snap(key,data));return {docs,size:docs.length};}
 }); exports.adminDb={collection:name=>query(name)};`,
 "lib/calendar/slot-occupancy": `exports.computeDaySlotOccupancy=async()=>({slots:[]});exports.rangeOverlapsFullSlots=()=>globalThis.__visits.full;`,
 "lib/leave/server": `exports.mapLeaveDoc=(id,data)=>({id,...data});`,
 "app/api/jobs/[id]/route": `exports.PATCH=async request=>{const body=await request.json();const s=globalThis.__visits;s.writes++;s.last=body;return Response.json({ok:true,booking:{status:'scheduled'}});};`,
 "app/api/jobs/route": `exports.POST=async request=>{const body=await request.json();const s=globalThis.__visits;s.writes++;s.last=body;if(s.createFailure)throw new Error('lost response');return Response.json({ok:true,booking:{bookingCode:'BK-NEW'}},{status:201});};`,
 "app/api/requests/route": `exports.POST=async request=>{const body=await request.json();const s=globalThis.__visits;s.writes++;s.last=body;if(s.createFailure)throw new Error('lost response');return Response.json({ok:true,request:{requestCode:'IR-NEW',status:'scheduled',assignedTo:null}},{status:201});};`,
 "app/api/requests/[id]/route": `exports.PATCH=async request=>{const body=await request.json();const s=globalThis.__visits;s.writes++;s.last=body;return Response.json({ok:true,request:{status:'scheduled'}});};`,
};
const paths=new Map(Object.entries(sources).map(([key,value],index)=>{const file=join(folder,`${index}.cjs`);writeFileSync(file,value);return ['@/'+key,pathToFileURL(file).href]}));
const hook=registerHooks({resolve(specifier:string,context:unknown,next:(s:string,c:unknown)=>unknown){const url=paths.get(specifier);return url?{url,format:'commonjs',shortCircuit:true}:next(specifier,context)}});
after(()=>{hook.deregister();rmSync(folder,{recursive:true,force:true})});
const owner={businessId:'business-a',uid:'owner-a',timezone:'Australia/Melbourne',authorization:'Bearer owner-a'};
beforeEach(()=>{
 state.rows.clear();state.writes=0;state.last=null;state.createFailure=false;state.full=false;
 state.rows.set('businesses:business-a',{ownerUid:'owner-a',isActive:true,status:'active',timezone:'Australia/Melbourne',workingHours:{startTime:'08:00',endTime:'17:00'},aiAssignmentTravelBufferMin:0});
 state.rows.set('services:service-a',{businessId:'business-a',name:'LED installation',isActive:true,staffIds:['staff-a']});
 state.rows.set('users:staff-a',{businessId:'business-a',role:'staff',status:'active',isActive:true,fullName:'Alex Smith',canget_qutaion:true,availability:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>({day,isOff:false}))});
 const row={businessId:'business-a',status:'scheduled',serviceId:'service-a',customer:{fullName:'John'},scheduledSlot:{date:'2099-01-05',timeRange:'morning'},scheduledStartTime:'09:00',scheduledEndTime:'10:00',assignedTo:{uid:'staff-a',type:'staff',name:'Alex Smith'}};
 state.rows.set('jobs:job-a',{...row,bookingCode:'BK-001'});
 state.rows.set('requests:request-a',{...row,requestCode:'IR-001'});
});

test('voice visit flag is opt-in and all preparation tools use the confirmation gate',()=>{
 assert.equal(ownerVisitsEnabled({}),false);
 assert.equal(ownerVisitsEnabled({AI_OWNER_VOICE_VISITS_ENABLED:'true'}),true);
 assert.ok(OWNER_PREPARE_TOOL_NAMES.includes('prepare_job_schedule'));
 assert.ok(OWNER_PREPARE_TOOL_NAMES.includes('prepare_inspection_cancel'));
 assert.ok(OWNER_PREPARE_TOOL_NAMES.includes('prepare_job_create'));
 assert.ok(OWNER_PREPARE_TOOL_NAMES.includes('prepare_inspection_create'));
 assert.equal(checkPendingChange({createdAt:1000},true,2000).ok,false);
 assert.equal(checkPendingChange({createdAt:1000},false,10000).ok,false);
});

test('preparing a schedule never writes; confirmation forwards only the validated version and window',async()=>{
 const {prepareOwnerVisit,confirmOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 state.rows.delete('requests:request-a');
 const prepared=await prepareOwnerVisit(owner,{reference:'BK-001',date:'2099-01-06',startTime:'09:00',endTime:'10:00'},'job','schedule');
 assert.equal(prepared.ok,true);if(!prepared.ok)return;
 assert.equal(state.writes,0);assert.match(prepared.summary,/2099-01-06/);
 assert.equal((await confirmOwnerVisit(owner,prepared.payload)).status,'DONE');
 assert.equal(state.writes,1);assert.equal(state.last?.action,'reschedule');assert.equal(state.last?.expectedVersion,'1000:1');
});

test('staff leave and conflicts block preparation and are rechecked at confirmation',async()=>{
 const {prepareOwnerVisit,confirmOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 state.rows.delete('requests:request-a');
 const args={reference:'BK-001',date:'2099-01-06',startTime:'09:00',endTime:'10:00'};
 const prepared=await prepareOwnerVisit(owner,args,'job','schedule');assert.equal(prepared.ok,true);if(!prepared.ok)return;
 state.rows.set('leaveRequests:leave-a',{businessId:'business-a',requesterUid:'staff-a',status:'approved',fromDate:'2099-01-06',toDate:'2099-01-06',isFullDay:true});
 assert.equal((await confirmOwnerVisit(owner,prepared.payload)).status,'REJECTED');assert.equal(state.writes,0);
 assert.equal((await prepareOwnerVisit(owner,args,'job','schedule')).ok,false);
});

test('changed, ambiguous and other-business records cannot apply a proposal',async()=>{
 const {prepareOwnerVisit,confirmOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 const p=await prepareOwnerVisit(owner,{reference:'BK-001'},'job','cancel');assert.equal(p.ok,true);if(!p.ok)return;
 state.rows.get('jobs:job-a')!.revision=2;
 assert.equal((await confirmOwnerVisit(owner,p.payload)).status,'STALE');assert.equal(state.writes,0);
 state.rows.set('jobs:duplicate',{...state.rows.get('jobs:job-a')!});
 assert.equal((await prepareOwnerVisit(owner,{reference:'BK-001'},'job','cancel')).ok,false);
 assert.equal((await prepareOwnerVisit({...owner,businessId:'business-b'},{reference:'BK-001'},'job','cancel')).ok,false);
});

test('inspection advice scheduling works without an invented service, and cancellation preserves the record',async()=>{
 const {prepareOwnerVisit,confirmOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 state.rows.delete('jobs:job-a');
 Object.assign(state.rows.get('requests:request-a')!,{serviceId:null,requestType:'custom_quote'});
 const p=await prepareOwnerVisit(owner,{reference:'IR-001',date:'2099-01-06',startTime:'09:00',endTime:'10:00'},'inspection','schedule');assert.equal(p.ok,true);if(!p.ok)return;
 assert.equal((await confirmOwnerVisit(owner,p.payload)).status,'DONE');assert.equal(state.last?.action,'accept');
 const cancelled=await prepareOwnerVisit(owner,{reference:'IR-001'},'inspection','cancel');assert.equal(cancelled.ok,true);if(!cancelled.ok)return;
 assert.equal((await confirmOwnerVisit(owner,cancelled.payload)).status,'DONE');assert.equal(state.last?.action,'cancel');assert.ok(state.rows.has('requests:request-a'));
});

test('recurring, linked, active and malformed changes are rejected',async()=>{
 const {prepareOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 for(const patch of [{seriesId:'series-a'},{additionalJobDays:[{}]},{status:'ongoing'},{visitStartedAt:1}])assert.ok(visitActionBlock('job',{status:'scheduled',...patch}));
 assert.ok(visitActionBlock('inspection',{status:'scheduled',bookingId:'job-a'}));
 assert.equal((await prepareOwnerVisit(owner,{reference:'BK-001',date:'2020-01-01',startTime:'09:00',endTime:'10:00'},'job','schedule')).ok,false);
 assert.equal((await prepareOwnerVisit(owner,{reference:'BK-001',date:'2099-02-30',startTime:'09:00',endTime:'10:00'},'job','schedule')).ok,false);
 assert.equal((await prepareOwnerVisit(owner,{reference:'BK-001',assignTo:'owner',businessId:'other'},'job','assignment')).ok,false);
 assert.equal((await prepareOwnerVisit(owner,{reference:'BK-001',staffName:'Alex Smith',date:'2099-01-06',startTime:'09:00',endTime:'10:00'},'job','schedule')).ok,false);
});

test('the final visit write uses a Firestore precondition and detects a concurrent edit',async()=>{
 const stamp=new Timestamp(1000,1);
 let writes=0;
 const snapshot={updateTime:stamp};
 const ref={async update(_updates:Row,precondition:{lastUpdateTime:Timestamp}){writes++;assert.equal(precondition.lastUpdateTime,stamp);throw {code:9}}};
 assert.equal(await updateVisitVersioned(ref as never,snapshot as never,{status:'cancelled'},'1000:1'),false);
 assert.equal(writes,1);
 assert.equal(await updateVisitVersioned(ref as never,snapshot as never,{status:'cancelled'},'1000:0'),false);assert.equal(writes,1);
});

test('pending visits can be assigned before scheduling; contradictory assignees are refused',async()=>{
 const {prepareOwnerVisit,confirmOwnerVisit}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 for(const [kind,key,reference] of [['job','jobs:job-a','BK-001'],['inspection','requests:request-a','IR-001']] as const){
  Object.assign(state.rows.get(key)!,{status:kind==='job'?'awaiting':'pending',scheduledSlot:null,scheduledStartTime:null,scheduledEndTime:null,assignedTo:null});
  const p=await prepareOwnerVisit(owner,{reference,staffName:'Alex Smith'},kind,'assignment');
  assert.equal(p.ok,true);if(!p.ok)continue;
  assert.equal((await confirmOwnerVisit(owner,p.payload)).status,'DONE');
  assert.equal(state.last?.action,'assign');assert.equal(state.last?.staffId,'staff-a');
  assert.equal((await prepareOwnerVisit(owner,{reference,assignTo:'owner',staffName:'Alex Smith'},kind,'assignment')).ok,false);
 }
});

test('scheduled job lookup includes future dates and filters status before limiting',async()=>{
 const {getOwnerVisits}=await import('../lib/ai/mcp/tools/owner-visits.tools');
 const row=state.rows.get('jobs:job-a')!;
 state.rows.delete('jobs:job-a');
 for(let i=0;i<55;i++)state.rows.set(`jobs:old-${i}`,{...row,status:'completed'});
 state.rows.set('jobs:job-a',row);
 state.rows.set('jobs:foreign',{...row,businessId:'other'});
 const result=await getOwnerVisits(owner,{kind:'job',status:'scheduled'});
 assert.equal(result.status,'OK');assert.equal(result.dateScope,'all dates');
 assert.equal((result.visits as Row[]).length,1);
 assert.deepEqual((result.visits as Row[])[0].slot,{date:'2099-01-05',timeRange:'morning'});
 const filtered=await getOwnerVisits(owner,{kind:'job',status:'scheduled',date:'2099-01-06'});
 assert.deepEqual(filtered.visits,[]);assert.equal(filtered.dateScope,'2099-01-06');
 assert.equal(state.writes,0);
});

const createArgs={customerFullName:'John Test',customerEmail:'john@example.test',customerPhone:'0400123456',serviceName:'LED installation',date:'2099-01-06',startTime:'09:00',endTime:'10:00',priceAud:150,assignTo:'staff',staffName:'Alex Smith',notes:'Install agreed light'};
test('new job preparation writes nothing, reads back financial effects, and confirmed creation uses Add job',async()=>{
 const {prepareOwnerJobCreate,confirmOwnerJobCreate}=await import('../lib/ai/mcp/tools/owner-job-create.tools');
 const p=await prepareOwnerJobCreate(owner,createArgs);assert.equal(p.ok,true);if(!p.ok)return;
 assert.equal(state.writes,0);assert.match(p.summary,/AUD 150.00/);assert.match(p.summary,/accepted quotation/);assert.match(p.summary,/invoice draft/);
 assert.equal((await confirmOwnerJobCreate(owner,p.payload)).reference,'BK-NEW');assert.equal(state.writes,1);
 assert.equal(state.last?.serviceId,'service-a');assert.equal(state.last?.budgetAud,150);
 assert.equal(state.last?.staffId,'staff-a');assert.equal(state.last?.requestType,'existing_service');
 assert.equal(state.last?.recurrence,undefined);
});
test('new jobs reject missing price/contact, injected IDs, duplicates, inactive services and past times',async()=>{
 const {prepareOwnerJobCreate}=await import('../lib/ai/mcp/tools/owner-job-create.tools');
 for(const patch of [{priceAud:undefined},{priceAud:150.123},{customerEmail:''},{customerPhone:'abc'},{customerPhone:'+ ( 1 )'},{businessId:'other'},{date:'2020-01-01'},{assignTo:'owner',staffName:'Alex Smith'},{recurrence:{interval:1}}]){
  assert.equal((await prepareOwnerJobCreate(owner,{...createArgs,...patch})).ok,false);
 }
 state.rows.set('services:duplicate',{...state.rows.get('services:service-a')!});
 assert.equal((await prepareOwnerJobCreate(owner,createArgs)).ok,false);state.rows.delete('services:duplicate');
 state.rows.get('services:service-a')!.isActive=false;
 assert.equal((await prepareOwnerJobCreate(owner,createArgs)).ok,false);assert.equal(state.writes,0);
});
test('new job confirmation rechecks service changes, leave and competing bookings',async()=>{
 const {prepareOwnerJobCreate,confirmOwnerJobCreate}=await import('../lib/ai/mcp/tools/owner-job-create.tools');
 const p=await prepareOwnerJobCreate(owner,createArgs);assert.equal(p.ok,true);if(!p.ok)return;
 state.rows.get('services:service-a')!.revision=2;
 assert.equal((await confirmOwnerJobCreate(owner,p.payload)).status,'STALE');state.rows.get('services:service-a')!.revision=1;
 state.rows.set('leaveRequests:new-leave',{businessId:'business-a',requesterUid:'staff-a',status:'approved',fromDate:'2099-01-06',toDate:'2099-01-06',isFullDay:true});
 assert.equal((await confirmOwnerJobCreate(owner,p.payload)).status,'REJECTED');state.rows.delete('leaveRequests:new-leave');
 state.rows.set('jobs:competing',{...state.rows.get('jobs:job-a')!,scheduledSlot:{date:'2099-01-06',timeRange:'morning'}});
 assert.equal((await confirmOwnerJobCreate(owner,p.payload)).status,'REJECTED');assert.equal(state.writes,0);
});

test('explicit free work assigned to owner is allowed and uncertain creation is never automatically retried',async()=>{
 const {prepareOwnerJobCreate,confirmOwnerJobCreate}=await import('../lib/ai/mcp/tools/owner-job-create.tools');
 const p=await prepareOwnerJobCreate(owner,{...createArgs,assignTo:'owner',staffName:undefined,priceAud:0});
 assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;assert.match(p.summary,/AUD 0.00/);
 state.createFailure=true;
 const result=await confirmOwnerJobCreate(owner,p.payload);
 assert.equal(result.status,'UNKNOWN');assert.match(result.message,/do not retry automatically/);assert.equal(state.writes,1);
});

const inspectionArgs={customerFullName:'John Test',customerEmail:'john@example.test',customerPhone:'0400123456',requestType:'existing_service',serviceName:'LED installation',date:'2099-01-06',startTime:'09:00',endTime:'10:00',notes:'Check light wiring'};
test('inspection preparation is read-only; confirmation creates a scheduled unassigned service visit',async()=>{
 const {prepareOwnerInspectionCreate,confirmOwnerInspectionCreate}=await import('../lib/ai/mcp/tools/owner-inspection-create.tools');
 const p=await prepareOwnerInspectionCreate(owner,inspectionArgs);assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;
 assert.equal(state.writes,0);assert.match(p.summary,/NO inspector assigned/);assert.match(p.summary,/notification behavior/);
 assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).reference,'IR-NEW');assert.equal(state.writes,1);
 assert.equal(state.last?.requestType,'existing_service');assert.equal(state.last?.serviceId,'service-a');assert.equal(state.last?.assignTo,undefined);
 assert.deepEqual(state.last?.calendarSchedule,{date:'2099-01-06',startTime:'09:00',endTime:'10:00'});
 assert.equal(state.last?.budgetAud,undefined);
});
test('advice inspection creation has a real title and details and never invents a service or quotation',async()=>{
 const {prepareOwnerInspectionCreate,confirmOwnerInspectionCreate}=await import('../lib/ai/mcp/tools/owner-inspection-create.tools');
 const args={...inspectionArgs,requestType:'custom_quote',serviceName:undefined,adviceTitle:'Advice about rewiring',adviceDescription:'Inspect switchboard'};
 const p=await prepareOwnerInspectionCreate(owner,args);assert.equal(p.ok,true,JSON.stringify(p));if(!p.ok)return;
 assert.equal(p.payload.serviceId,null);assert.equal(p.payload.serviceVersion,null);assert.match(p.summary,/Inspect switchboard/);
 assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).status,'DONE');
 assert.equal(state.last?.serviceId,null);assert.deepEqual(state.last?.customRequest,{title:'Advice about rewiring',description:'Inspect switchboard'});
 assert.equal(state.last?.priceAud,undefined);
});
test('inspection creation rejects mixed types, missing contacts/details, forged IDs and invalid dates',async()=>{
 const {prepareOwnerInspectionCreate}=await import('../lib/ai/mcp/tools/owner-inspection-create.tools');
 for(const patch of [{requestType:'custom_quote'},{serviceName:undefined},{adviceTitle:'Unexpected advice'},{customerEmail:''},{customerPhone:'invalid'},{date:'2099-02-30'},{date:'2020-01-01'},{startTime:'11:00',endTime:'10:00'},{assignTo:'owner'},{businessId:'other'},{serviceId:'forged'}]){
  assert.equal((await prepareOwnerInspectionCreate(owner,{...inspectionArgs,...patch})).ok,false,JSON.stringify(patch));
 }
 assert.equal((await prepareOwnerInspectionCreate({...owner,businessId:'other'},inspectionArgs)).ok,false);
 state.rows.set('services:duplicate',{...state.rows.get('services:service-a')!});
 assert.equal((await prepareOwnerInspectionCreate(owner,inspectionArgs)).ok,false);assert.equal(state.writes,0);
});
test('inspection confirmation rechecks closures, capacity, active service and owner authority',async()=>{
 const {prepareOwnerInspectionCreate,confirmOwnerInspectionCreate}=await import('../lib/ai/mcp/tools/owner-inspection-create.tools');
 const p=await prepareOwnerInspectionCreate(owner,inspectionArgs);assert.equal(p.ok,true);if(!p.ok)return;
 state.rows.set('business_closures:closed',{businessId:'business-a',date:'2099-01-06'});
 assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).status,'REJECTED');state.rows.delete('business_closures:closed');
 state.full=true;assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).status,'REJECTED');state.full=false;
 state.rows.get('services:service-a')!.revision=2;
 assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).status,'STALE');state.rows.get('services:service-a')!.revision=1;
 state.rows.get('services:service-a')!.isActive=false;
 assert.equal((await confirmOwnerInspectionCreate(owner,p.payload)).status,'REJECTED');state.rows.get('services:service-a')!.isActive=true;
 assert.equal((await confirmOwnerInspectionCreate({...owner,uid:'other'},p.payload)).status,'REJECTED');assert.equal(state.writes,0);
});
test('uncertain inspection creation returns UNKNOWN without retrying',async()=>{
 const {prepareOwnerInspectionCreate,confirmOwnerInspectionCreate}=await import('../lib/ai/mcp/tools/owner-inspection-create.tools');
 const p=await prepareOwnerInspectionCreate(owner,inspectionArgs);assert.equal(p.ok,true);if(!p.ok)return;
 state.createFailure=true;const result=await confirmOwnerInspectionCreate(owner,p.payload);
 assert.equal(result.status,'UNKNOWN');assert.match(result.message,/do not retry automatically/);assert.equal(state.writes,1);
});
