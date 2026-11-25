import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {adminDb} from "@/lib/firebase/admin";
import {lookupVoiceDidRoute} from "@/lib/ai/data/did-mappings";
import {normalizeInvoiceCallbackNumber} from "./callback-number";
import {phoneComparisonKey} from "@/lib/users/phone-uniqueness";

export const OWNER_CALL_SETTINGS="ai_owner_call_settings";
export const ownerNotificationsEnabled=()=>process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED==="true";
export const ownerNotificationInput=z.object({enabled:z.boolean(),newInspections:z.boolean(),phone:z.string().trim().max(40),did:z.string().max(15),consent:z.literal(true)}).strict().refine(value=>!value.enabled||/^\d{6,15}$/.test(value.did));
export const ownerNotificationRequest=z.object({requestId:z.string().min(1).max(128).refine(v=>!v.includes('/')),requestCode:z.string().min(1).max(80),ownerUid:z.string().min(1).max(128),settingsVersion:z.string().min(1),expiresAt:z.number().finite()});
export type OwnerNotificationSettings={enabled:boolean;newInspections:boolean;phone:string;did:string;ownerUid:string;version:string;ownerName:string};
export async function requireActualOwner(businessId:string,uid:string){
 const business=(await adminDb.collection("businesses").doc(businessId).get()).data();
 return !!business&&business.ownerUid===uid;
}
export async function saveOwnerNotificationSettings(businessId:string,uid:string,input:unknown){
 if(!await requireActualOwner(businessId,uid))throw Error("Only the current business owner can configure owner calls.");
 const parsed=ownerNotificationInput.safeParse(input);if(!parsed.success)throw Error("Choose an owner phone, business number and confirm permission to call.");
 if(!parsed.data.enabled){
  await adminDb.collection(OWNER_CALL_SETTINGS).doc(businessId).set({enabled:false,newInspections:parsed.data.newInspections,phone:parsed.data.phone,did:parsed.data.did,ownerUid:uid,version:randomUUID(),ownerName:"the business owner",updatedAt:Date.now()});
  return {...parsed.data,phone:parsed.data.phone};
 }
 const number=normalizeInvoiceCallbackNumber(parsed.data.phone);if(!number)throw Error("Enter a supported owner mobile or phone number.");
 const route=await lookupVoiceDidRoute(parsed.data.did);
 if(route.state!=="active"||route.binding.businessId!==businessId||route.business.ownerUid!==uid||!route.callback?.callerId)throw Error("Choose an active business number with outbound calls configured.");
 // Never dial any mapped business DID: that could create a receptionist loop.
 const contacts=await Promise.all([number,number.startsWith("0")?`61${number.slice(1)}`:number].map(did=>adminDb.collection("ai_did_mappings").doc(did).get()));
 if(phoneComparisonKey(number)===phoneComparisonKey(parsed.data.did)||contacts.some(doc=>doc.exists))throw Error("Use the owner's personal contact number, not a business reception DID.");
 const user=(await adminDb.collection("users").doc(uid).get()).data();
 const settings:OwnerNotificationSettings={enabled:parsed.data.enabled,newInspections:parsed.data.newInspections,phone:number,did:parsed.data.did,ownerUid:uid,version:randomUUID(),ownerName:String(user?.fullName||"the business owner").slice(0,120)};
 await adminDb.collection(OWNER_CALL_SETTINGS).doc(businessId).set({...settings,updatedAt:Date.now()});return settings;
}

/** Persist intent only. The existing scheduled-call worker is the only dialler. */
export async function queueOwnerInspectionCall(businessId:string,requestId:string,options:{automatic:true}){
 if(options.automatic!==true)return {status:"DISABLED"};
 if(!ownerNotificationsEnabled()||process.env.AI_SOPHIE_CALLBACK_ENABLED!=="true"||process.env.AI_VOICE_CALL_LOGS_ENABLED==="false")return {status:"DISABLED"};
 if(!requestId||requestId.includes('/'))throw Error("Choose an inspection request.");
 const [saved,inspection]=await Promise.all([adminDb.collection(OWNER_CALL_SETTINGS).doc(businessId).get(),adminDb.collection("requests").doc(requestId).get()]);
 const settings=saved.data() as OwnerNotificationSettings|undefined,row=inspection.data();
 if(!settings?.enabled||!settings.newInspections)return {status:"DISABLED"};
 if(!row||row.businessId!==businessId)throw Error("Inspection request not found for this business.");
 if(!["pending","scheduled","owner_proposed"].includes(row.status))throw Error("This inspection no longer needs a new-request alert.");
 if(["job_direct","invoice_direct","quotation_direct"].includes(row.createdSource))return {status:"SKIPPED"};
 const route=await lookupVoiceDidRoute(settings.did);
 if(route.state!=="active"||route.binding.businessId!==businessId||route.business.ownerUid!==settings.ownerUid||!route.callback?.callerId)throw Error("Owner outbound route is unavailable.");
 const number=normalizeInvoiceCallbackNumber(settings.phone);if(!number||phoneComparisonKey(number)===phoneComparisonKey(settings.did))throw Error("Owner contact number is invalid.");
 const originalCreatedAt=typeof row.createdAt?.toMillis==="function"?row.createdAt.toMillis():typeof row.createdAt==="number"?row.createdAt:Date.now();
 if(Date.now()-originalCreatedAt>86400000)return {status:"EXPIRED"};
 const id=createHash("sha256").update(`${businessId}:${requestId}:owner-notification:automatic`).digest("hex");
 const ref=adminDb.collection("ai_scheduled_callbacks").doc(id);
 const result=await adminDb.runTransaction(async tx=>{
   const [existing,currentBusiness,currentSettings,currentRequest]=await Promise.all([tx.get(ref),tx.get(adminDb.collection("businesses").doc(businessId)),tx.get(saved.ref),tx.get(inspection.ref)]);
   if(existing.exists)return "ALREADY_QUEUED";
   if(currentBusiness.get("ownerUid")!==settings.ownerUid||currentSettings.get("version")!==settings.version||currentRequest.get("businessId")!==businessId)throw Error("Owner settings changed. Review and retry.");
   tx.create(ref,{businessId,did:settings.did,number,numberKey:phoneComparisonKey(number),customerName:settings.ownerName,purpose:"owner_notification",source:"new_inspection",ownerUid:settings.ownerUid,settingsVersion:settings.version,requestId,requestCode:String(row.requestCode||requestId).slice(0,80),status:"OWNER_SCHEDULED",scheduledAt:Date.now(),originalScheduledAt:Date.now(),expiresAt:Date.now()+86400000,createdAt:Date.now(),updatedAt:Date.now()});return "SCHEDULED";
 });
 return {status:result,id};
}
export async function validateDueOwnerNotification(data:Record<string,unknown>,businessOwnerUid:unknown){
 const parsed=ownerNotificationRequest.safeParse(data);if(!parsed.success)return "Owner alert details are invalid.";
 if(!ownerNotificationsEnabled()||process.env.AI_VOICE_CALL_LOGS_ENABLED==="false")return "Owner call notifications or call logging are disabled.";
 if(parsed.data.expiresAt<Date.now())return "Owner alert expired.";
 const number=normalizeInvoiceCallbackNumber(String(data.number??""));if(!number)return "Owner contact number is invalid.";
 const mappedContacts=await Promise.all([...new Set([number,number.startsWith("0")?`61${number.slice(1)}`:number])].map(did=>adminDb.collection("ai_did_mappings").doc(did).get()));
 if(mappedContacts.some(doc=>doc.exists))return "Owner contact became a reception DID; call cancelled to prevent a loop.";
 const [saved,inspection]=await Promise.all([adminDb.collection(OWNER_CALL_SETTINGS).doc(String(data.businessId)).get(),adminDb.collection("requests").doc(parsed.data.requestId).get()]);
 const settings=saved.data(),row=inspection.data();
 if(!settings?.enabled||data.source==="new_inspection"&&!settings.newInspections||settings.ownerUid!==businessOwnerUid||data.ownerUid!==businessOwnerUid||settings.version!==data.settingsVersion||settings.did!==data.did||normalizeInvoiceCallbackNumber(String(settings.phone??""))!==data.number)return "Owner permission, contact or routing changed.";
 if(!row||row.businessId!==data.businessId||!["pending","scheduled","owner_proposed"].includes(String(row.status)))return "Inspection no longer needs a new-request alert.";
 return null;
}
