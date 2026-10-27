import { after, NextResponse } from "next/server";
import { requireBookingBusiness } from "@/lib/callcenter/booking-access";
import { validatePreferredSlotsAvailable } from "@/lib/booking/slot-availability";
import { createInspectionRequest } from "@/lib/inspection/server";
import { parseInspectionRequestInput } from "@/lib/inspection/types";
import { adminDb } from "@/lib/firebase/admin";
import { logAuditEvent } from "@/lib/audit/server";
import { sendSophieInspectionOwnerAlert } from "@/lib/notifications/sophie-owner-alert";

export const runtime = "nodejs";

function postSaveTask(stage: string, task: () => Promise<unknown>) {
  after(async () => {
    try { await task(); }
    catch { console.error("[call-center-bookings] Post-save task failed", { stage }); }
  });
}

export async function POST(request: Request) {
  // Reject missing credentials before parsing; check scope before business data.
  if (!request.headers.get("authorization")) return NextResponse.json({ ok: false, error: "Missing authorization header." }, { status: 401 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  const auth = await requireBookingBusiness(request, body?.businessId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const parsed = parseInspectionRequestInput(body, auth.timeZone);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  if (parsed.value.requestType !== "existing_service" || !parsed.value.serviceId ||
      !/^[^/]{1,128}$/.test(parsed.value.serviceId) || [".", ".."].includes(parsed.value.serviceId)) {
    return NextResponse.json({ ok: false, error: "Select an existing service for this business." }, { status: 400 });
  }
  const service = (await adminDb.collection("services").doc(parsed.value.serviceId).get()).data();
  if (!service || service.businessId !== auth.businessId || service.isActive !== true) {
    return NextResponse.json({ ok: false, error: "Select an active service from this business." }, { status: 400 });
  }
  const slots = await validatePreferredSlotsAvailable(auth.businessId, parsed.value.preferredSlots, auth.timeZone);
  if (!slots.ok) return NextResponse.json(slots, { status: 400 });
  const autoAssign = auth.isAi && body.aiAutoAssignStaff === true &&
    process.env.AI_AUTO_ASSIGN_STAFF_ENABLED === "true" && auth.business.sophieBookingAuthority === true;
  const result = await createInspectionRequest(auth.businessId, parsed.value, {
    customerId: null, createdSource: "call_center", autoAssignStaff: autoAssign,
    autoConfirmStaff: autoAssign, assignmentSource: "sophie",
    scheduleNotifications: task => postSaveTask("customer-and-business-notifications", task),
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  const created = result.request;
  // A saved request must be acknowledged before email/SMS providers finish.
  // Next's after() retains these tasks for execution after the HTTP response.
  postSaveTask("audit", () => logAuditEvent({ businessId: auth.businessId, category: "inspection", action: "inspection.created",
    actor: { uid: auth.uid, role: "call_center", name: auth.name, email: auth.email }, source: "system",
    summary: `Inspection ${created.requestCode ?? created.id} submitted by ${auth.isAi ? "AI receptionist" : "call-center agent"}`,
    targetId: created.id, targetLabel: created.serviceName || null }));
  if (auth.isAi) postSaveTask("sophie-owner-alert", () => sendSophieInspectionOwnerAlert({ businessId: auth.businessId,
    requestCode: created.requestCode || created.id, customerName: created.customer.fullName || "Customer",
    serviceName: created.serviceName || "Inspection request", status: created.status === "scheduled" ? "scheduled" : "pending",
    date: created.scheduledSlot?.date || created.aiAssignment?.proposedSlot?.date || null,
    timeRange: created.scheduledSlot?.timeRange || created.aiAssignment?.proposedSlot?.timeRange || null,
    startTime: created.scheduledStartTime || created.aiAssignment?.proposedSlot?.startTime || null,
    endTime: created.scheduledEndTime || created.aiAssignment?.proposedSlot?.endTime || null,
    staffName: created.assignedTo?.type === "staff" ? created.assignedTo.name : null }));
  return NextResponse.json({ ok: true, requestId: created.id, status: created.status,
    confirmed: created.status === "scheduled", ...(created.aiAssignment ? { staffAssignment: created.aiAssignment } : {}) });
}
