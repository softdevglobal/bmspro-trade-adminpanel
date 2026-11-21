import "server-only";
import {z} from "zod";
import {adminDb} from "@/lib/firebase/admin";
import {ownerVisitCreateFields} from "@/lib/ai/owner-call/owner-visit-create";
import {visitVersion} from "@/lib/scheduling/visit-version";
import {parseInspectionRequestInput} from "@/lib/inspection/types";
import {validateOwnerInspectionSchedule} from "./owner-visits.tools";
import * as requestsApi from "@/app/api/requests/route";
import type {ActionOwner} from "./owner-actions.tools";
import type {VoiceResult} from "@/lib/ai/owner-call/owner-team";

export const ownerInspectionCreateInput = z.object({
  ...ownerVisitCreateFields,
  requestType:z.enum(["existing_service","custom_quote"]),
  serviceName:z.string().trim().min(1).max(160).optional(),
  adviceTitle:z.string().trim().min(3).max(160).optional(),
  adviceDescription:z.string().trim().max(2000).optional(),
}).strict();
type Row = Record<string, unknown>;
export type PreparedInspectionCreate = {body:Row; schedule:Row; serviceId:string|null; serviceVersion:string|null};
const rejected = (message:string):{ok:false;result:VoiceResult} => ({ok:false,result:{status:"REJECTED",message}});

export async function prepareOwnerInspectionCreate(owner:ActionOwner,args:unknown):Promise<{ok:true;payload:PreparedInspectionCreate;summary:string}|{ok:false;result:VoiceResult}> {
  const parsed=ownerInspectionCreateInput.safeParse(args);
  if(!parsed.success)return rejected("Ask for verified customer name, email and phone, inspection type, exact future date/start/end, and either the configured service or advice title/details. Address and notes are optional. Creation leaves the inspector unassigned; assign separately after creation. Do not invent missing details or supply internal IDs.");
  const input=parsed.data;
  const advice=input.requestType==="custom_quote";
  if(advice ? !input.adviceTitle || !!input.serviceName : !input.serviceName || input.adviceTitle!==undefined || input.adviceDescription!==undefined) return rejected("Choose one type: an exact configured service, or an advice request with a title and no service. Do not mix the two.");
  let serviceId:string|null=null, serviceVersion:string|null=null;
  let label=input.adviceTitle!;
  if(!advice){
    const services=await adminDb.collection("services").where("businessId","==",owner.businessId).get();
    const matches=services.docs.filter(doc=>String(doc.data().name??"").trim().toLowerCase()===input.serviceName!.toLowerCase());
    if(matches.length!==1)return rejected("No single service matched that exact name. Read the services and ask the owner to clarify.");
    serviceId=matches[0].id;serviceVersion=visitVersion(matches[0]);label=String(matches[0].data().name);
  }
  const slot={date:input.date,timeRange:Number(input.startTime.slice(0,2))<12?"morning":"afternoon",startTime:input.startTime,endTime:input.endTime};
  const body:Row={requestType:input.requestType,serviceId,
    customRequest:advice?{title:input.adviceTitle,description:input.adviceDescription??""}:null,
    customer:{fullName:input.customerFullName,email:input.customerEmail.toLowerCase(),phone:input.customerPhone.replace(/\D/g,"")},
    address:input.address??{street:"",suburb:"",state:"",postcode:""},customerNotes:input.notes??"",
    preferredSlots:[slot],calendarSchedule:{date:input.date,startTime:input.startTime,endTime:input.endTime},
  };
  const valid=parseInspectionRequestInput(body,owner.timezone,{requireAddress:false});
  if(!valid.ok)return rejected(valid.error);
  const schedule:Row={requestType:input.requestType,serviceId,scheduledSlot:slot,scheduledStartTime:input.startTime,scheduledEndTime:input.endTime};
  const error=await validateOwnerInspectionSchedule(owner,schedule);if(error)return rejected(error);
  const address=input.address?Object.values(input.address).filter(Boolean).join(", ")||"not set":"not set";
  const summary=`Create one NEW ${advice?"advice":"service"} inspection for ${input.customerFullName}, email ${input.customerEmail.toLowerCase()}, phone ending ${input.customerPhone.replace(/\D/g,"").slice(-4)}; ${label}${advice?`; details ${input.adviceDescription||"none"}`:""}; ${input.date} ${input.startTime}–${input.endTime} (${owner.timezone||"Australia/Melbourne"}); address ${address}; notes ${input.notes||"none"}. The visit will be scheduled with NO inspector assigned. Assign an inspector separately after creation. This uses Add inspection and its existing customer account and notification behavior; it does not create an accepted quotation or invoice.`;
  return {ok:true,payload:{body,schedule,serviceId,serviceVersion},summary};
}

export async function confirmOwnerInspectionCreate(owner:ActionOwner,payload:PreparedInspectionCreate):Promise<VoiceResult>{
  if(payload.serviceId){
    const service=await adminDb.collection("services").doc(payload.serviceId).get();
    if(!service.exists||service.data()?.businessId!==owner.businessId||visitVersion(service)!==payload.serviceVersion)return {status:"STALE",message:"The service changed after the read-back. Prepare the inspection again."};
  }
  const error=await validateOwnerInspectionSchedule(owner,payload.schedule);if(error)return {status:"REJECTED",message:error};
  try{
    const response=await requestsApi.POST(new Request("http://trade.internal/api/requests",{method:"POST",headers:{Authorization:owner.authorization,"Content-Type":"application/json"},body:JSON.stringify(payload.body)}));
    const result=await response.json();
    if(!response.ok||result.ok===false)return {status:response.status>=500?"UNKNOWN":"REJECTED",message:result.error??"Could not confirm creation. Check Site inspections before trying again."};
    return {status:"DONE",reference:result.request?.requestCode??null,message:`Created inspection ${result.request?.requestCode??"successfully"}. The visit is scheduled and unassigned. Assign an inspector separately.`};
  }catch{return {status:"UNKNOWN",message:"Creation result is uncertain. Check Site inspections before preparing another request; do not retry automatically."};}
}
