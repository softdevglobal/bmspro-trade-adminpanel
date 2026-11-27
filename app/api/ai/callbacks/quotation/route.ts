import {after} from "next/server";
import {authenticateVoiceBridge} from "@/lib/ai/config";
import {readFollowUpQuotation,recordFollowUpQuotationDecision,completeQuotationDecisionEffects} from "@/lib/ai/calls/quotation-follow-up-actions";
export const runtime="nodejs";
export async function POST(request:Request){
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
 const auth=await authenticateVoiceBridge(request);if(!auth.ok)return json({status:"UNAVAILABLE"},auth.status);
 try{
  const body=await request.text();if(body.length>1024)return json({status:"REJECTED"},400);
  const input=JSON.parse(body);
  if(!input||Object.keys(input).some(key=>!["attemptId","operation","customerConfirmed","decisionConfirmed","decision"].includes(key))||!/^[a-f0-9]{64}$/.test(input.attemptId??"")||input.customerConfirmed!==true)return json({status:"REJECTED"},400);
  const {consumeRateLimits}=await import("@/lib/security/rate-limit");
  if(!await consumeRateLimits([{key:`quote-followup:${input.attemptId}`,limit:20,windowMs:60000}]))return json({status:"UNAVAILABLE"},429);
  const number=request.headers.get("x-bmspro-caller-number");
  if(input.operation==="details"&&input.decision===undefined&&input.decisionConfirmed===undefined)return json(await readFollowUpQuotation(auth.binding,input.attemptId,number));
  if(input.operation!=="decision"||input.decisionConfirmed!==true||!["accepted","rejected"].includes(input.decision))return json({status:"REJECTED"},400);
  const result=await recordFollowUpQuotationDecision(auth.binding,input.attemptId,number,input.decision);
  if(result.status==="RECORDED")after(async()=>{try{await completeQuotationDecisionEffects(input.attemptId);}catch{console.error("[sophie-quotation-calls] Decision follow-up pending",{attemptId:input.attemptId});}});
  return json(result);
 }catch{return json({status:"UNAVAILABLE"},503);}
}
