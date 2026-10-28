import { NextResponse } from "next/server";
import { createAgentActivity, listAgentActivities } from "@/lib/callcenter/agent-activities";
import { callCenterError, intParam, readJsonObject, readTenantId, requireCallCenterTenant } from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * POST /api/call-center/agent-activities — log a call.
 * Body: `{ businessId (or ownerId / X-Tenant-Id), callId, callerNumber, callerName?, agentNote?,
 *   didNumber?, queueId?, queueName?, recordingUrl?, recordingFileName? }`.
 * Agent fields come from the token. → 201 `{ ok, id, activity }`.
 */
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return callCenterError(400, "Invalid JSON body.");
  const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
  const auth = await requireCallCenterTenant(request, {
    body,
    ...(ownerId && !readTenantId(request, body) ? { businessId: ownerId } : {}),
  });
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  try {
    const result = await createAgentActivity(auth, body);
    if (!result.ok) return callCenterError(result.status, result.error);
    return NextResponse.json({ ok: true, id: result.id, activity: result.activity }, { status: 201 });
  } catch (error) {
    console.error("[call-center] POST /agent-activities failed:", error);
    return callCenterError(500, "Could not save the call log.");
  }
}

/**
 * GET /api/call-center/agent-activities?businessId=&agentUserId=&agentEmail=&callId=&limit=
 * Newest first; `limit` default 25 (1–100). `ownerId` is accepted for `businessId`.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const ownerId = query.get("ownerId")?.trim() ?? "";
  const auth = await requireCallCenterTenant(
    request,
    ownerId && !readTenantId(request) ? { businessId: ownerId } : {},
  );
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  try {
    const activities = await listAgentActivities(auth.businessId, {
      agentUserId: query.get("agentUserId")?.trim() || undefined,
      agentEmail: query.get("agentEmail")?.trim() || undefined,
      callId: query.get("callId")?.trim() || undefined,
      limit: intParam(query.get("limit"), 25, 1, 100),
    });
    return NextResponse.json({ ok: true, activities, total: activities.length });
  } catch (error) {
    console.error("[call-center] GET /agent-activities failed:", error);
    return callCenterError(500, "Could not fetch call logs.");
  }
}
