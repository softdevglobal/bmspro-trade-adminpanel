import {adminDb} from "@/lib/firebase/admin";
import {requireBusinessOwner} from "@/lib/onboarding/services/server";
import {consumeRateLimits} from "@/lib/security/rate-limit";
import {OWNER_CALL_SETTINGS,ownerNotificationsEnabled,requireActualOwner,saveOwnerNotificationSettings} from "@/lib/ai/calls/owner-notifications";
export const runtime="nodejs";
const json=(data:object,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
async function owner(request:Request){
 const auth=await requireBusinessOwner(request);if(!auth.ok)return auth;
 if(!await requireActualOwner(auth.businessId,auth.uid))return {ok:false as const,status:403,error:"Current business owner access required."};return auth;
}
export async function GET(request:Request){
 const auth=await owner(request);if(!auth.ok)return json({error:auth.error},auth.status);
 const [settings,mappings]=await Promise.all([adminDb.collection(OWNER_CALL_SETTINGS).doc(auth.businessId).get(),adminDb.collection("ai_did_mappings").where("businessId","==",auth.businessId).where("isActive","==",true).limit(20).get()]);
 const row=settings.get("ownerUid")===auth.uid?settings.data():null;
 return json({available:ownerNotificationsEnabled()&&process.env.AI_SOPHIE_CALLBACK_ENABLED==="true"&&process.env.AI_VOICE_CALL_LOGS_ENABLED!=="false",settings:{enabled:row?.ownerUid===auth.uid&&row?.enabled===true,newInspections:row?.newInspections===true,phone:typeof row?.phone==="string"?row.phone:"",did:typeof row?.did==="string"?row.did:""},numbers:mappings.docs.map(doc=>doc.id)});
}
export async function PATCH(request:Request){
 const auth=await owner(request);if(!auth.ok)return json({error:auth.error},auth.status);
 if(!await consumeRateLimits([{key:`owner-call-settings:${auth.uid}`,limit:10,windowMs:600000}]))return json({error:"Too many updates. Try again shortly."},429);
 try{const settings=await saveOwnerNotificationSettings(auth.businessId,auth.uid,await request.json());return json({ok:true,settings:{enabled:settings.enabled,newInspections:settings.newInspections,phone:settings.phone,did:settings.did}});}
 catch(error){return json({error:error instanceof Error?error.message:"Could not save owner call settings."},400);}
}
