import {adminDb} from "@/lib/firebase/admin";
import {requireBusinessOwner} from "@/lib/onboarding/services/server";
import {consumeRateLimits} from "@/lib/security/rate-limit";
import {OWNER_CALL_SETTINGS,ownerNotificationsEnabled,queueOwnerInspectionCall,requireActualOwner,saveOwnerNotificationSettings} from "@/lib/ai/calls/owner-notifications";
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
export async function POST(request:Request){
 const auth=await owner(request);if(!auth.ok)return json({error:auth.error},auth.status);
 if(!ownerNotificationsEnabled()||process.env.AI_SOPHIE_CALLBACK_ENABLED!=="true"||process.env.AI_VOICE_CALL_LOGS_ENABLED==="false")return json({error:"Owner call notifications are not enabled on the server."},503);
 if(!await consumeRateLimits([{key:`owner-call-manual:${auth.uid}`,limit:3,windowMs:600000}]))return json({error:"Too many owner call requests. Try again later."},429);
 const body=await request.json().catch(()=>null);
 if(typeof body?.reference!=="string"||body.reference.length>80||typeof body?.idempotencyKey!=="string")return json({error:"Choose an inspection reference and confirm the owner call."},400);
 try{
  const matches=await adminDb.collection("requests").where("businessId","==",auth.businessId).where("requestCode","==",body.reference.trim()).limit(2).get();
  if(matches.size!==1)return json({error:"No unique inspection matched this reference in your business."},404);
  const result=await queueOwnerInspectionCall(auth.businessId,matches.docs[0].id,{automatic:false,uid:auth.uid,idempotencyKey:body.idempotencyKey});
  return ["SCHEDULED","ALREADY_QUEUED"].includes(result.status)?json(result):json({error:"Enable owner calls and save the contact number first."},409);
 }catch(error){return json({error:error instanceof Error?error.message:"Could not queue owner call."},400);}
}
