import { authenticateVoiceBridge } from "@/lib/ai/config";
import { getPhoneCallerAccess } from "@/lib/ai/calls/caller-access";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await authenticateVoiceBridge(request);
  const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{"Cache-Control":"no-store"}});
  if (!auth.ok) return json({error:"Caller recognition unavailable."}, auth.status);
  try {
    const {consumeRateLimits} = await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{key:`phone-caller-access:${auth.binding.businessId}`,limit:60,windowMs:60000}]))
      return json({error:"Caller recognition unavailable."},429);
    return json(await getPhoneCallerAccess(auth.binding.businessId, request.headers.get("x-bmspro-caller-number")));
  } catch { return json({role:"customer",ownerAccess:false,verificationRequired:true}); }
}
