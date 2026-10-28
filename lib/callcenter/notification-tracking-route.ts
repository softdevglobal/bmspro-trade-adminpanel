import "server-only";

import { NextResponse } from "next/server";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import {
  getCustomerNotificationBusinessId,
  setNotificationTracking,
  type TrackingKind,
} from "@/lib/callcenter/customer-notifications";
import { callCenterError, readJsonObject, requireCallCenterTenant } from "@/lib/callcenter/tenant";

/**
 * Shared by POST …/customer-notifications/{id}/called-customer and
 * …/notification-reviewed. Body (optional): `{ "<flag>": true | false }`,
 * missing = true. The agent must have access to the notification's business.
 */
export async function handleNotificationTrackingRoute(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
  kind: TrackingKind,
): Promise<NextResponse> {
  const { notificationId } = await context.params;
  // Authenticate before revealing whether the notification exists.
  const agent = await requireCallCenterAgent(request);
  if (!agent.ok) return callCenterError(agent.status, agent.error);
  const body = await readJsonObject(request);
  if (!body) return callCenterError(400, "Invalid JSON body.");

  const target = await getCustomerNotificationBusinessId(notificationId ?? "");
  if (!target.ok) return callCenterError(target.status, target.error);
  const auth = await requireCallCenterTenant(request, { businessId: target.businessId, humanOnly: true });
  if (!auth.ok) return callCenterError(auth.status, auth.error);

  const field = kind === "called-customer" ? "calledCustomer" : "notificationReviewed";
  try {
    const result = await setNotificationTracking(notificationId, kind, body[field] !== false, {
      uid: auth.uid,
      name: auth.name ?? null,
      email: auth.email ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[call-center] POST /customer-notifications/${kind} failed:`, error);
    return callCenterError(500, "Could not update the notification.");
  }
}
