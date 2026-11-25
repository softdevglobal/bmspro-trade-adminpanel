import { authenticateVoiceBridge } from "@/lib/ai/config";
import { authorizeOwnerNotificationRead } from "@/lib/ai/calls/owner-inspection-details";
import {ownerPhoneToolDefinitions,parseOwnerPhoneTool} from "@/lib/ai/calls/owner-phone-tools";
import {ownerBriefingTools} from "@/lib/ai/mcp/tools/owner-briefing.tools";
export const runtime="nodejs";
export async function POST(request:Request) {
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  const auth=await authenticateVoiceBridge(request);
  if (!auth.ok) return json({status:"UNAVAILABLE"},auth.status);
  try {
    const body=await request.text(); if(body.length>8192)return json({status:"REJECTED"},400);
    const input=JSON.parse(body);
    if(!input||Object.keys(input).some(key=>!["attemptId","tool","args"].includes(key))||!/^[a-f0-9]{64}$/.test(input.attemptId??""))return json({status:"REJECTED"},400);
    const {consumeRateLimits}=await import("@/lib/security/rate-limit");
    if(!await consumeRateLimits([{key:`owner-phone-briefing:${input.attemptId}`,limit:30,windowMs:60000}]))return json({status:"UNAVAILABLE"},429);
    const context=await authorizeOwnerNotificationRead(auth.binding,input.attemptId,request.headers.get("x-bmspro-caller-number"));
    if(!context)return json({status:"UNAVAILABLE"},403);
    if(input.tool===undefined && input.args===undefined)return json({status:"OK",tools:ownerPhoneToolDefinitions()});
    const selected=parseOwnerPhoneTool(input.tool,input.args);
    if(!selected)return json({status:"REJECTED"},400);
    const briefing=ownerBriefingTools(auth.binding.businessId,context.business.timezone||"Australia/Melbourne");
    return json({status:"OK",result:await selected.tool.run({briefing},selected.args)});
  } catch {return json({status:"UNAVAILABLE"},503);}
}
