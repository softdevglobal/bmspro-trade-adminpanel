import {z} from "zod";
import {authenticateVoiceBridge} from "@/lib/ai/config";
import {readFollowUpInvoice,recordInvoiceCustomerResponse} from "@/lib/ai/calls/invoice-follow-up-actions";
import {invoiceResponseInput} from "@/lib/ai/calls/invoice-follow-up-policy";
import {consumeRateLimits} from "@/lib/security/rate-limit";
import {notifyBusinessNotificationsChanged} from "@/lib/notifications/realtime-hub";
export const runtime="nodejs";
const schema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("details"),attemptId:z.string().regex(/^[a-f0-9]{64}$/),customerConfirmed:z.literal(true)}).strict(),
 z.object({operation:z.literal("response"),attemptId:z.string().regex(/^[a-f0-9]{64}$/),customerConfirmed:z.literal(true),response:invoiceResponseInput}).strict(),
 z.object({operation:z.literal("wrong_contact"),attemptId:z.string().regex(/^[a-f0-9]{64}$/),wrongPersonConfirmed:z.literal(true)}).strict(),
]);
export async function POST(request:Request){
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
 const auth=await authenticateVoiceBridge(request);if(!auth.ok)return json({status:"UNAVAILABLE"},auth.status);
 if(process.env.AI_SOPHIE_CALLBACK_ENABLED!=="true")return json({status:"UNAVAILABLE"},403);
 try{
  const text=await request.text();if(text.length>1500)return json({status:"REJECTED"},400);
  const parsed=schema.safeParse(JSON.parse(text));if(!parsed.success)return json({status:"REJECTED"},400);
  const input=parsed.data;
  if(!await consumeRateLimits([{key:`invoice-followup:${input.attemptId}`,limit:20,windowMs:60000}]))return json({status:"UNAVAILABLE"},429);
  const number=request.headers.get("x-bmspro-caller-number");
  if(input.operation==="response"&&input.response.outcome==="wrong_person")return json({status:"REJECTED"},400);
  const result=input.operation==="details"?await readFollowUpInvoice(auth.binding,input.attemptId,number):await recordInvoiceCustomerResponse(auth.binding,input.attemptId,number,input.operation==="wrong_contact"?{outcome:"wrong_person"}:input.response);
  if(input.operation!=="details"&&result.status==="RECORDED")notifyBusinessNotificationsChanged(auth.binding.businessId);
  return json(result);
 }catch{return json({status:"UNAVAILABLE"},503);}
}
