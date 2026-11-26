import { platformTodayIso } from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { getIndexedQuery } from "@/lib/firebase/indexed-query";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

const statuses = new Set(["SCHEDULED", "CALLING", "ANSWERED", "NO_ANSWER", "FAILED", "CANCELLED", "SKIPPED", "UNKNOWN"]);

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const date = new URL(request.url).searchParams.get("date") ?? platformTodayIso();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(date) ? zonedDateTimeToUtcMs(date, "00:00") : null;
  const endMinute = start !== null ? zonedDateTimeToUtcMs(date, "23:59") : null;
  if (start === null || endMinute === null || platformTodayIso(new Date(start)) !== date) {
    return json({ error: "Choose a valid scheduled date." }, 400);
  }
  const end = endMinute + 60_000;
  try {
    const base = adminDb.collection("ai_scheduled_callbacks").where("businessId", "==", auth.businessId);
    const snapshot = await getIndexedQuery("scheduled-call-history",
      base.where("scheduledAt", ">=", start).where("scheduledAt", "<", end)
        .orderBy("scheduledAt", "desc").limit(100), base.limit(100));
    const calls = snapshot.docs.filter(doc => {
      const at = doc.get("scheduledAt");
      return typeof at === "number" && at >= start && at < end;
    }).map(doc => {
      const data = doc.data();
      const digits = typeof data.number === "string" ? data.number.replace(/\D/g, "") : "";
      const status = ["OWNER_SCHEDULED","OWNER_NUMBER_SCHEDULED"].includes(data.status) ? "SCHEDULED" : typeof data.status === "string" && statuses.has(data.status) ? data.status : "FAILED";
      return {
        id: doc.id,
        status,
        scheduledAt: typeof data.scheduledAt === "number" ? data.scheduledAt : null,
        attemptedAt: typeof data.attemptedAt === "number" ? data.attemptedAt : null,
        completedAt: typeof data.completedAt === "number" ? data.completedAt : null,
        customerName: typeof data.customerName === "string" ? data.customerName : null,
        callerLastFour: digits.length >= 4 ? digits.slice(-4) : null,
        did: typeof data.did === "string" ? data.did : null,
        purpose: data.purpose === "owner_notification" ? "Owner notification · New inspection" : data.purpose === "owner_requested" ? "Owner-requested call" : data.purpose === "overdue_invoice" ? "Overdue invoice" : "Missed-call follow-up",
        category:data.purpose==="owner_requested"&&typeof data.category==="string"?data.category:null,
        instructions:data.purpose==="owner_notification"?`Notify the business owner about inspection ${String(data.requestCode??"").slice(0,80)}.`:data.purpose==="owner_requested"&&typeof data.instructions==="string"?data.instructions:null,
        callLogId:typeof data.callLogId==="string"&&/^[a-f0-9-]{36}$/i.test(data.callLogId)?data.callLogId:null,
        reason: typeof data.reason === "string" ? data.reason : null,
      };
    }).sort((a, b) => (b.scheduledAt ?? 0) - (a.scheduledAt ?? 0));
    return json({ calls });
  } catch {
    return json({ error: "Could not load scheduled calls." }, 503);
  }
}

/** Cancellation races the worker claim in a transaction; a dial already claimed cannot be recalled. */
export async function PATCH(request:Request){
  const auth=await requireBusinessOwner(request);if(!auth.ok)return json({error:auth.error},auth.status);
  const body=await request.json().catch(()=>null);
  if(body?.action!=="cancel"||typeof body.id!=="string"||!/^[a-f0-9]{64}$/.test(body.id))return json({error:"Choose a scheduled owner call."},400);
  const ref=adminDb.collection("ai_scheduled_callbacks").doc(body.id);
  const result=await adminDb.runTransaction(async tx=>{
    const snap=await tx.get(ref);const row=snap.data();
    if(!row||row.businessId!==auth.businessId||!["owner_requested","owner_notification"].includes(row.purpose))return {status:404,error:"Scheduled owner call not found."};
    if(!["SCHEDULED","OWNER_SCHEDULED","OWNER_NUMBER_SCHEDULED"].includes(row.status))return {status:409,error:"This call was already processed or has started dialing."};
    tx.update(ref,{status:"CANCELLED",reason:"Cancelled by the business owner.",updatedAt:Date.now()});return {status:200};
  });
  return result.status===200?json({ok:true}):json({error:result.error},result.status);
}
