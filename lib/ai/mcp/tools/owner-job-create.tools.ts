import "server-only";
import {z} from "zod";
import {ownerVisitCreateFields} from "@/lib/ai/owner-call/owner-visit-create";
import {adminDb} from "@/lib/firebase/admin";
import {visitVersion} from "@/lib/scheduling/visit-version";
import {parseInspectionRequestInput} from "@/lib/inspection/types";
import {validateOwnerJobSchedule} from "./owner-visits.tools";
import * as jobsApi from "@/app/api/jobs/route";
import type {ActionOwner} from "./owner-actions.tools";
import type {VoiceResult} from "@/lib/ai/owner-call/owner-team";

export const ownerJobCreateInput = z.object({
  ...ownerVisitCreateFields,
  serviceName: z.string().trim().min(1).max(160),
  priceAud: z.number().finite().min(0).max(10000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001),
  assignTo: z.enum(["owner", "staff"]), staffName: z.string().trim().min(1).max(120).optional(),
}).strict();
type Row = Record<string, unknown>;
export type PreparedJobCreate = {body: Row; serviceId: string; serviceVersion: string; schedule: Row};
const rejected = (message: string): {ok:false; result:VoiceResult} => ({ok:false,result:{status:"REJECTED",message}});

export async function prepareOwnerJobCreate(owner: ActionOwner, args: unknown): Promise<{ok:true;payload:PreparedJobCreate;summary:string}|{ok:false;result:VoiceResult}> {
  const parsed = ownerJobCreateInput.safeParse(args);
  if (!parsed.success) return rejected("Ask for the customer's full name, email and phone, an exact configured service, future date, start/end time, agreed price in AUD (including explicit zero for free work), and who will do the job. Use the editor for custom, recurring or multi-day jobs. Do not invent missing details.");
  const input = parsed.data;
  if (input.assignTo === "owner" && input.staffName || input.assignTo === "staff" && !input.staffName) return rejected("Choose either the owner or one exact staff full name.");
  const services = await adminDb.collection("services").where("businessId","==",owner.businessId).get();
  const matches = services.docs.filter(doc => String(doc.data().name ?? "").trim().toLowerCase() === input.serviceName.toLowerCase());
  if (matches.length !== 1) return rejected("No single configured service matched that exact name. Read the services and ask the owner to clarify.");
  const service = matches[0];
  let staffId: string | undefined;
  let assignedName = "the business owner";
  if (input.assignTo === "staff") {
    const staff = await adminDb.collection("users").where("businessId","==",owner.businessId).get();
    const matchingStaff = staff.docs.filter(doc => String(doc.data().fullName ?? "").trim().toLowerCase() === input.staffName!.toLowerCase());
    if (matchingStaff.length !== 1) return rejected("No single staff member matched that full name. Ask the owner to clarify.");
    staffId = matchingStaff[0].id; assignedName = String(matchingStaff[0].data().fullName);
  }
  const slot = {date:input.date,timeRange:Number(input.startTime.slice(0,2)) < 12 ? "morning" : "afternoon",startTime:input.startTime,endTime:input.endTime};
  const body: Row = {
    requestType:"existing_service", serviceId:service.id,
    customer:{fullName:input.customerFullName,email:input.customerEmail.toLowerCase(),phone:input.customerPhone.replace(/\D/g,"")},
    address:input.address ?? {street:"",suburb:"",state:"",postcode:""},
    // The shared booking parser accepts positive budgets or null. Add job maps null
    // to a zero-price quotation; allow that only after an explicit priceAud=0.
    preferredSlots:[slot], budgetAud:input.priceAud === 0 ? null : input.priceAud, customerNotes:input.notes ?? "",
    assignTo:input.assignTo, ...(staffId ? {staffId} : {}),
  };
  const validated = parseInspectionRequestInput(body, owner.timezone, {requireAddress:false});
  if (!validated.ok) return rejected(validated.error);
  const schedule: Row = {serviceId:service.id,requestType:"existing_service",scheduledSlot:slot,scheduledStartTime:input.startTime,scheduledEndTime:input.endTime,
    assignedTo:{type:input.assignTo,uid:staffId ?? owner.uid,name:assignedName}};
  const error = await validateOwnerJobSchedule(owner,schedule);
  if (error) return rejected(error);
  const address = input.address ? Object.values(input.address).filter(Boolean).join(", ") || "not set" : "not set";
  const summary = `Create one NEW job for ${input.customerFullName}, email ${input.customerEmail.toLowerCase()}, phone ending ${input.customerPhone.replace(/\D/g,"").slice(-4)}; service ${service.data().name}; ${input.date} ${input.startTime}–${input.endTime} (${owner.timezone || "Australia/Melbourne"}); assigned to ${assignedName}; agreed total AUD ${input.priceAud.toFixed(2)}; address ${address}; notes ${input.notes || "none"}. This uses Add job: it also creates completed request/accepted quotation records, may create an invoice draft, and uses existing customer account and notification behavior. Only proceed for already agreed work.`;
  return {ok:true,payload:{body,serviceId:service.id,serviceVersion:visitVersion(service),schedule},summary};
}

export async function confirmOwnerJobCreate(owner: ActionOwner, payload: PreparedJobCreate): Promise<VoiceResult> {
  const service = await adminDb.collection("services").doc(payload.serviceId).get();
  if (!service.exists || service.data()?.businessId !== owner.businessId || visitVersion(service) !== payload.serviceVersion) return {status:"STALE",message:"The service changed after the read-back. Prepare the job again."};
  const error = await validateOwnerJobSchedule(owner,payload.schedule);
  if (error) return {status:"REJECTED",message:error};
  try {
    const response = await jobsApi.POST(new Request("http://trade.internal/api/jobs",{method:"POST",headers:{Authorization:owner.authorization,"Content-Type":"application/json"},body:JSON.stringify(payload.body)}));
    const result = await response.json();
    if (!response.ok || result.ok === false) return {status:response.status >= 500 ? "UNKNOWN" : "REJECTED",message:result.error ?? "Could not confirm creation. Check Jobs before trying again."};
    return {status:"DONE",reference:result.booking?.bookingCode ?? null,message:`Created job ${result.booking?.bookingCode ?? "successfully"}. Check Jobs for its details.`};
  } catch { return {status:"UNKNOWN",message:"Creation result is uncertain. Check Jobs before preparing another job; do not retry automatically."}; }
}
