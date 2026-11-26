import "server-only";
import {randomBytes} from "node:crypto";
import {adminDb} from "@/lib/firebase/admin";
import {lookupVoiceDidRoute} from "@/lib/ai/data/did-mappings";
import {normalizeInvoiceCallbackNumber} from "@/lib/ai/calls/callback-number";
import {isCustomerCallOptedOut} from "@/lib/ai/calls/call-preferences";
import {isWithinSophieCallingHours} from "@/lib/ai/calls/calling-hours";
import {ownerCallInput,ownerScheduledCallsEnabled} from "@/lib/ai/owner-call/owner-scheduled-calls";
import {zonedDateTimeToUtcMs} from "@/lib/platform/zoned-datetime";
import {visitVersion} from "@/lib/scheduling/visit-version";
import {phoneComparisonKey} from "@/lib/users/phone-uniqueness";
import {isDirectOwnerCallNumberAllowed} from "@/lib/ai/calls/owner-number-destination";
import type {ActionOwner} from "./owner-actions.tools";
import type {VoiceResult} from "@/lib/ai/owner-call/owner-team";
export type PreparedOwnerCall={id:string;customerId:string|null;customerVersion:string|null;customerName:string;recipientSource?:"saved_customer"|"owner_number";recipientNameKnown?:boolean;number:string;did:string;scheduledAt:number;timezone:string;category:string;instructions:string};
const refuse=(message:string):{ok:false;result:VoiceResult}=>({ok:false,result:{status:"REJECTED",message}});

export async function findOwnerCallCustomers(owner:ActionOwner,args:unknown):Promise<VoiceResult>{
 const search=typeof (args as {search?:unknown})?.search==="string"?String((args as {search:string}).search).trim().toLowerCase():"";
 const suppliedNumber=normalizeInvoiceCallbackNumber(search);
 if(suppliedNumber)return {status:"OK",number:suppliedNumber,customers:[],message:"The owner supplied a phone number. Use prepare_customer_scheduled_call with number directly; no saved customer, name, email or call history is required. Read back the full number and schedule details for confirmation."};
 if(search.length<2)return {status:"INVALID",message:"Ask for at least two characters of the customer name or email."};
 const snap=await adminDb.collection("customers").where("registeredBusinessId","==",owner.businessId).limit(101).get();
 const customers=snap.docs.slice(0,100).map(doc=>doc.data()).filter(row=>`${row.fullName} ${row.email}`.toLowerCase().includes(search)).slice(0,20).map(row=>({name:row.fullName,email:row.email,phoneEnding:String(row.phone??"").replace(/\D/g,"").slice(-4)}));
 return {status:"OK",message:"Use an exact full name and email if names repeat. Partial results do not prove a customer is absent.",customers,partial:snap.size>100||customers.length===20};
}

export async function validateOwnerScheduledCall(owner:ActionOwner,p:PreparedOwnerCall):Promise<string|null>{
 if(!ownerScheduledCallsEnabled()||process.env.AI_SOPHIE_CALLBACK_ENABLED!=="true"||process.env.AI_VOICE_CALL_LOGS_ENABLED==="false")return "Owner scheduled calls or call logging are disabled.";
 if(p.scheduledAt<=Date.now()||p.scheduledAt>Date.now()+30*86400000)return "Choose a future time within 30 days.";
 const route=await lookupVoiceDidRoute(p.did);
 if(p.recipientSource==="owner_number"){
  if(p.customerId!==null||!await isDirectOwnerCallNumberAllowed(p.number))return "Use a supported external contact number, not a business reception number.";
 }else{
  if(!p.customerId)return "Choose a saved customer or give the exact number to call.";
  const customer=await adminDb.collection("customers").doc(p.customerId).get(),data=customer.data();
  if(!data||data.registeredBusinessId!==owner.businessId||visitVersion(customer)!==p.customerVersion||normalizeInvoiceCallbackNumber(String(data.phone??""))!==p.number)return "The customer contact changed. Find the customer and prepare the call again.";
 }
 if(route.state!=="active"||route.binding.businessId!==owner.businessId||route.business.ownerUid!==owner.uid||!route.callback?.callerId)return "This business's outbound call route is unavailable.";
 const timezone=route.business.timezone||"Australia/Melbourne";
 if(timezone!==p.timezone)return "The business timezone changed. Prepare the call again.";
 if(!isWithinSophieCallingHours(p.scheduledAt,timezone,route.business.sophieCallingHours??undefined))return "Choose a time inside the business's Sophie calling hours.";
 if(await isCustomerCallOptedOut(owner.businessId,p.number))return "This customer has asked not to receive Sophie calls.";
 return null;
}

export async function prepareOwnerScheduledCall(owner:ActionOwner,args:unknown):Promise<{ok:true;payload:PreparedOwnerCall;summary:string}|{ok:false;result:VoiceResult}>{
 const parsed=ownerCallInput.safeParse(args);if(!parsed.success)return refuse("Ask for either the owner's exact phone number OR a saved customer, plus date/time, category and a clear purpose. A number-only call does not require a name, customer record or call history. Never invent a number.");
 const input=parsed.data;
 let customerId:string|null=null,customerVersion:string|null=null,customerName=input.customerName||"Number-only contact",number:string|null=null;
 if(input.number){number=normalizeInvoiceCallbackNumber(input.number);if(!number)return refuse("Ask for a supported Australian or Sri Lankan phone number, preserving the country code and digits.");}
 else{
  let query=adminDb.collection("customers").where("registeredBusinessId","==",owner.businessId).where("fullName","==",input.customerName!);
  if(input.customerEmail)query=query.where("email","==",input.customerEmail.toLowerCase());
  const matches=await query.limit(2).get();if(matches.size!==1)return refuse("No single saved customer matched. Clarify the saved name/email, or use the exact phone number if the owner supplies it. A supplied number needs no saved customer.");
  const customer=matches.docs[0],data=customer.data();number=normalizeInvoiceCallbackNumber(String(data.phone??""));customerId=customer.id;customerVersion=visitVersion(customer);customerName=String(data.fullName).slice(0,120);
  if(!number)return refuse("This saved customer has no supported number. Ask the owner for the exact phone number instead.");
 }
 let routes=adminDb.collection("ai_did_mappings").where("businessId","==",owner.businessId).where("isActive","==",true);
 if(input.businessNumber)routes=routes.where("did","==",input.businessNumber);
 const mappings=await routes.limit(2).get();if(mappings.size!==1)return refuse("Choose the business phone number: there is no single active phone mapping for this business.");
 const did=mappings.docs[0].id,route=await lookupVoiceDidRoute(did);
 if(route.state!=="active"||route.binding.businessId!==owner.businessId)return refuse("The business call route is unavailable.");
 const timezone=route.business.timezone||"Australia/Melbourne",scheduledAt=zonedDateTimeToUtcMs(input.date,input.time,timezone);
 if(scheduledAt===null)return refuse("Choose a real local date and time.");
 const payload:PreparedOwnerCall={id:randomBytes(32).toString("hex"),customerId,customerVersion,customerName,recipientSource:input.number?"owner_number":"saved_customer",recipientNameKnown:!!customerId||!!input.customerName,number,did,scheduledAt,timezone,category:input.category,instructions:input.instructions};
 const error=await validateOwnerScheduledCall(owner,payload);if(error)return refuse(error);
 const recipient=input.number?`${input.customerName||"the contact"} at the owner-supplied number ${number}`:`${payload.customerName}, phone ending ${number.slice(-4)}`;
 return {ok:true,payload,summary:`Schedule Sophie to call ${recipient} on ${input.date} at ${input.time} (${timezone}), from business number ${did}. Purpose: ${input.category}. Ask/discuss: ${input.instructions}. ${input.number?"No customer identity is verified from this number; discuss general owner questions without disclosing private account records. ":""}Sophie will confirm the person is willing to speak and save the conversation and response for review. Busy bridge/calling-hour restrictions can delay the call; this is not an exact-time guarantee.`};
}

export async function confirmOwnerScheduledCall(owner:ActionOwner,payload:PreparedOwnerCall):Promise<VoiceResult>{
 const error=await validateOwnerScheduledCall(owner,payload);if(error)return {status:"REJECTED",message:error};
 const {id,customerVersion,...data}=payload;
 void customerVersion;
 await adminDb.collection("ai_scheduled_callbacks").doc(id).create({...data,businessId:owner.businessId,numberKey:phoneComparisonKey(payload.number),purpose:"owner_requested",source:"owner",requestedBy:owner.uid,status:payload.recipientSource==="owner_number"?"OWNER_NUMBER_SCHEDULED":"SCHEDULED",createdAt:Date.now(),updatedAt:Date.now(),originalScheduledAt:payload.scheduledAt,expiresAt:payload.scheduledAt+2*3600000});
 return {status:"DONE",message:`Scheduled the call to ${payload.recipientNameKnown===false?`the number ending ${payload.number.slice(-4)}`:payload.customerName}. Review it under Calls → Scheduled calls.`,kind:"owner_call_schedule",scheduledAt:payload.scheduledAt};
}
