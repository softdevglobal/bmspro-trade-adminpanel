import { authenticateVoiceBridge } from "@/lib/ai/config";
import { readOwnerInspectionDetails } from "@/lib/ai/calls/owner-inspection-details";

export const runtime="nodejs";
export async function POST(request:Request) {
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  const auth=await authenticateVoiceBridge(request);
  if (!auth.ok) return json({status:"UNAVAILABLE"},auth.status);
  try {
    const body=await request.text();
    if (body.length>512) return json({status:"UNAVAILABLE"},400);
    const input=JSON.parse(body);
    if (!input || Object.keys(input).some(key=>key!=="attemptId") || !/^[a-f0-9]{64}$/.test(input.attemptId??""))
      return json({status:"UNAVAILABLE"},400);
    const {consumeRateLimits}=await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{key:`owner-inspection-details:${input.attemptId}`,limit:12,windowMs:60000}]))
      return json({status:"UNAVAILABLE"},429);
    const inspection=await readOwnerInspectionDetails(auth.binding,input.attemptId,request.headers.get("x-bmspro-caller-number"));
    return inspection ? json({status:"OK",inspection}) : json({status:"UNAVAILABLE"},403);
  } catch { return json({status:"UNAVAILABLE"},503); }
}
