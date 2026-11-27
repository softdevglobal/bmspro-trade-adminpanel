import {requireBusinessOwner} from "@/lib/onboarding/services/server";
import {adminDb} from "@/lib/firebase/admin";
import {loadSophieCalendar} from "@/lib/calendar/sophie-events.server";
import {zonedDateTimeToUtcMs} from "@/lib/platform/zoned-datetime";
import {consumeRateLimits} from "@/lib/security/rate-limit";
import {parseBusinessModuleSettings} from "@/lib/business/module-settings";
export const runtime="nodejs";
export async function GET(request:Request){
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
 const auth=await requireBusinessOwner(request);if(!auth.ok)return json({error:auth.error},auth.status);
 try{
  const business=(await adminDb.collection("businesses").doc(auth.businessId).get()).data();
  if(!business||business.ownerUid!==auth.uid||business.isActive!==true||business.status==="suspended")return json({error:"Sophie calendar is available to the current business owner."},403);
  const params=new URL(request.url).searchParams,from=params.get("from")||"",to=params.get("to")||"",timezone=business.timezone||"Australia/Melbourne";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return json({error:"Choose a valid calendar range."},400);
  const start=zonedDateTimeToUtcMs(from,"00:00",timezone),end=zonedDateTimeToUtcMs(to,"00:00",timezone);
  if(start===null||end===null||end<=start||end-start>62*86400000)return json({error:"Choose a calendar range of up to 62 days."},400);
  if(!await consumeRateLimits([{key:`sophie-calendar:${auth.uid}`,limit:30,windowMs:60000}]))return json({error:"Refresh the Sophie calendar again shortly."},429);
  const modules=parseBusinessModuleSettings(business);
  const result=await loadSophieCalendar(adminDb,auth.businessId,start,end,timezone,{invoices:modules.invoices,quotations:modules.quotations});
  return json({...result,timezone});
 }catch(error){console.error("[sophie-calendar] Read failed",{code:(error as {code?:unknown})?.code??"unknown"});return json({error:"Could not load Sophie activities. Check calendar indexes and try again."},503);}
}
