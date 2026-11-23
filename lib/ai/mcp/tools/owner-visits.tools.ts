import "server-only";
import {adminDb} from "@/lib/firebase/admin";
import {visitVersion} from "@/lib/scheduling/visit-version";
import {visitActionInput, visitListInput, visitActionBlock, type VisitKind, type VisitOperation} from "@/lib/ai/owner-call/owner-visits";
import {planTradeStaffAssignment, staffCanPerformService} from "@/lib/team/ai-assignment-planner";
import {mapLeaveDoc} from "@/lib/leave/server";
import {parseWorkingHoursFromBusiness} from "@/lib/calendar/working-hours";
import {computeDaySlotOccupancy, rangeOverlapsFullSlots} from "@/lib/calendar/slot-occupancy";
import {platformTodayIso} from "@/lib/platform/timezone";
import {zonedDateTimeToUtcMs} from "@/lib/platform/zoned-datetime";
import * as jobApi from "@/app/api/jobs/[id]/route";
import * as inspectionApi from "@/app/api/requests/[id]/route";
import type {ActionOwner} from "./owner-actions.tools";
import type {VoiceResult} from "@/lib/ai/owner-call/owner-team";

type Row = Record<string, unknown>;
type Assignment = {uid: string; type: string; name: string};
export type PreparedVisit = {id: string; kind: VisitKind; operation: VisitOperation; reference: string; body: Row; expectedVersion: string};
const collection = (kind: VisitKind) => kind === "job" ? "jobs" : "requests";
const codeField = (kind: VisitKind) => kind === "job" ? "bookingCode" : "requestCode";
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const refuse = (message: string): {ok: false; result: VoiceResult} => ({ok: false, result: {status: "REJECTED", message}});

export async function getOwnerVisits(owner: ActionOwner, args: unknown): Promise<VoiceResult> {
  const parsed = visitListInput.safeParse(args);
  if (!parsed.success) return {status: "INVALID", message: "Use a job or inspection kind, an exact date and short search text."};
  const input = parsed.data;
  const kinds: VisitKind[] = input?.kind === "job" ? ["job"] : input?.kind === "inspection" ? ["inspection"] : ["job", "inspection"];
  const visits: Row[] = [];
  let partial = false;
  for (const kind of kinds) {
    let query = adminDb.collection(collection(kind)).where("businessId", "==", owner.businessId);
    if (input.status) query = query.where("status", "==", input.status);
    if (input?.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return {status: "INVALID", message: "Use an exact YYYY-MM-DD date."};
      query = query.where("scheduledSlot.date", "==", input.date);
    }
    const snap = await query.limit(51).get(); partial ||= snap.size > 50;
    for (const doc of snap.docs.slice(0, 50)) {
      const row = doc.data(); const customer = row.customer as {fullName?: string} | undefined;
      const reference = row[codeField(kind)];
      const term = String(input?.search ?? "").trim().toLowerCase();
      if (term && !`${reference ?? ""} ${customer?.fullName ?? ""} ${row.serviceName ?? ""}`.toLowerCase().includes(term)) continue;
      visits.push({kind, reference: reference ?? null, customer: customer?.fullName ?? null, status: row.status,
        slot: row.scheduledSlot ?? null, startTime: row.scheduledStartTime ?? null, endTime: row.scheduledEndTime ?? null,
        assignedTo: (row.assignedTo as Assignment | undefined)?.name ?? null});
    }
  }
  return {status: "OK", visits, partial, dateScope: input.date ?? "all dates", statusFilter: input.status ?? "all statuses", message: "Without a date filter these are records across all dates, not just today. State the scheduled date of each visit. Use an exact job/inspection reference for changes. If results are partial or several match, ask the owner which record; never guess."};
}

async function validateVisit(owner: ActionOwner, snap: FirebaseFirestore.DocumentSnapshot, kind: VisitKind, operation: VisitOperation, body: Row): Promise<string | null> {
  return validateVisitData(owner, snap.data(), snap.id, kind, operation, body);
}

/** Shared preflight for a new direct job, without creating a temporary record. */
export function validateOwnerJobSchedule(owner: ActionOwner, row: Row) {
  return validateVisitData(owner, {...row, businessId: owner.businessId, status: "scheduled"}, "", "job", "schedule", {});
}

/** The Add inspection route creates a scheduled, unassigned request. */
export function validateOwnerInspectionSchedule(owner: ActionOwner, row: Row) {
  return validateVisitData(owner, {...row, businessId: owner.businessId, status: "scheduled"}, "", "inspection", "schedule", {}, true);
}

async function validateVisitData(owner: ActionOwner, row: FirebaseFirestore.DocumentData | undefined, id: string, kind: VisitKind, operation: VisitOperation, body: Row, allowUnassigned = false): Promise<string | null> {
  if (!row || row.businessId !== owner.businessId) return "Visit not found for this business.";
  const block = visitActionBlock(kind, row); if (block) return block;
  if (operation === "cancel") return null;
  const slot = body.slot as {date: string; timeRange: string} | undefined ?? row.scheduledSlot;
  const start = String(body.startTime ?? row.scheduledStartTime ?? ""), end = String(body.endTime ?? row.scheduledEndTime ?? "");
  if (!slot && operation === "assignment") {
    const business = (await adminDb.collection("businesses").doc(owner.businessId).get()).data();
    if (!business || business.ownerUid !== owner.uid || business.isActive !== true || business.status === "suspended") return "Business owner access is unavailable.";
    if (body.assignTo === "owner") return null;
    const member = (await adminDb.collection("users").doc(String(body.staffId)).get()).data();
    if (!member || member.businessId !== owner.businessId || member.role !== "staff" || member.status !== "active" || member.isActive === false || member.suspended === true) return "The staff member is no longer available.";
    if (kind === "inspection" && row.requestType === "custom_quote") return member.canget_qutaion === true ? null : "The staff member cannot handle advice inspections.";
    if (typeof row.serviceId !== "string" || !row.serviceId) return "Use the Trade editor for work without a configured service.";
    const service = await adminDb.collection("services").doc(row.serviceId).get();
    return service.data()?.businessId === owner.businessId && service.data()?.isActive === true && staffCanPerformService({...member, id: body.staffId}, {...service.data(), id: service.id}) ? null : "The staff member is not qualified for this service.";
  }
  if (!slot || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return "Choose an existing date and time in the Trade editor before changing this visit by voice.";
  const business = (await adminDb.collection("businesses").doc(owner.businessId).get()).data();
  if (!business || business.ownerUid !== owner.uid || business.isActive !== true || business.status === "suspended") return "Business owner access is unavailable.";
  const timezone = business.timezone || owner.timezone || "Australia/Melbourne";
  const when = zonedDateTimeToUtcMs(slot.date, start, timezone);
  if (when === null || when <= Date.now() || platformTodayIso(new Date(when), timezone) !== slot.date || minutes(end) <= minutes(start)) return "Choose a real future date and an end time after the start time.";
  const workingHours = parseWorkingHoursFromBusiness(business);
  if (minutes(start) < minutes(workingHours.startTime) || minutes(end) > minutes(workingHours.endTime)) return "Choose a time within business working hours.";
  const assignment = operation === "assignment"
    ? {uid: body.assignTo === "owner" ? owner.uid : String(body.staffId ?? ""), type: String(body.assignTo)}
    : row.assignedTo as Assignment | undefined;
  if (!assignment?.uid) {
    if (!allowUnassigned) return "Assign this visit first, then prepare and confirm its schedule separately.";
    const [closures, service, occupancy] = await Promise.all([
      adminDb.collection("business_closures").where("businessId", "==", owner.businessId).where("date", "==", slot.date).limit(1).get(),
      typeof row.serviceId === "string" && row.serviceId ? adminDb.collection("services").doc(row.serviceId).get() : Promise.resolve(null),
      computeDaySlotOccupancy(owner.businessId, slot.date),
    ]);
    if (closures.size) return "This business is closed on the selected date.";
    if (row.requestType === "custom_quote" ? row.serviceId != null : !service || service.data()?.businessId !== owner.businessId || service.data()?.isActive !== true) return "Choose an active service from this business, or an advice inspection without a service.";
    return rangeOverlapsFullSlots(occupancy.slots, start, end, "inspection") ? "That time window is full. Choose another time." : null;
  }
  const [staff, leaves, jobs, requests, closures, service] = await Promise.all([
    adminDb.collection("users").where("businessId", "==", owner.businessId).get(),
    adminDb.collection("leaveRequests").where("businessId", "==", owner.businessId).get(),
    adminDb.collection("jobs").where("businessId", "==", owner.businessId).get(),
    adminDb.collection("requests").where("businessId", "==", owner.businessId).get(),
    adminDb.collection("business_closures").where("businessId", "==", owner.businessId).get(),
    typeof row.serviceId === "string" && row.serviceId ? adminDb.collection("services").doc(row.serviceId).get() : Promise.resolve(null),
  ]);
  if (service && service.data()?.businessId !== owner.businessId) return "The service no longer belongs to this business.";
  const advice = kind === "inspection" && row.requestType === "custom_quote";
  if (!advice && !service) return "Use the Trade editor for work without a configured service.";
  const ownerStaff = {id: owner.uid, role: "staff", fullName: "Business owner", status: "active", canget_qutaion: true,
    availability: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => ({day, isOff: false}))};
  const plan = planTradeStaffAssignment({
    service: advice ? null : {...service!.data(), id: service!.id, ...(assignment.type === "owner" ? {staffIds: [owner.uid]} : {})},
    requestType: advice ? "custom_quote" : "existing_service",
    staff: assignment.type === "owner" ? [ownerStaff] : staff.docs.filter(doc => doc.id === assignment.uid).map(doc => ({...doc.data(), id: doc.id})),
    slots: [{...slot, startTime: start}], leave: leaves.docs.map(doc => mapLeaveDoc(doc.id, doc.data())),
    work: [...jobs.docs.filter(doc => kind !== "job" || doc.id !== id), ...requests.docs.filter(doc => kind !== "inspection" || doc.id !== id)].map(doc => doc.data()),
    closures: closures.docs.map(doc => String(doc.data().date)), timezone, workingHours, now: new Date(),
    durationMinutes: minutes(end) - minutes(start), travelBufferMinutes: business.aiAssignmentTravelBufferMin ?? 30,
    allowRunPastSession: kind === "job",
  });
  if (plan.assignedTo?.uid !== assignment.uid || plan.aiAssignment.proposedSlot?.startTime !== start || plan.aiAssignment.proposedSlot?.endTime !== end) return plan.aiAssignment.reason || "The selected staff member is not available at that time.";
  const occupancy = await computeDaySlotOccupancy(owner.businessId, slot.date, kind === "job" ? {excludeBookingId: id} : {excludeRequestId: id});
  if (rangeOverlapsFullSlots(occupancy.slots, start, end, kind === "job" ? "job" : "inspection")) return "That time window is full. Choose another time.";
  return null;
}

export async function prepareOwnerVisit(owner: ActionOwner, args: unknown, kind: VisitKind, operation: VisitOperation): Promise<{ok: true; payload: PreparedVisit; summary: string} | {ok: false; result: VoiceResult}> {
  const parsed = visitActionInput.safeParse(args);
  if (!parsed.success) return refuse("Use an exact reference and valid date/time or staff details. Do not supply internal IDs.");
  const input = parsed.data;
  if (operation === "schedule" && (input.staffName || input.assignTo)) return refuse("Assignment and scheduling are separate changes. Prepare and confirm each separately.");
  if (input.assignTo === "owner" && input.staffName) return refuse("Choose either the business owner or a named staff member, then prepare the assignment again.");
  if (operation !== "schedule" && (input.date || input.startTime || input.endTime)) return refuse("Date and time changes need the schedule tool.");
  if (operation === "cancel" && (input.staffName || input.assignTo)) return refuse("Cancellation must not contain an assignment change.");
  const matches = await adminDb.collection(collection(kind)).where("businessId", "==", owner.businessId).where(codeField(kind), "==", input.reference).limit(2).get();
  if (matches.size !== 1) return refuse("No single visit matched that exact reference. Look up the records and ask the owner which reference they mean.");
  const snap = matches.docs[0], row = snap.data();
  const body: Row = {action: operation === "schedule" ? kind === "job" ? "reschedule" : "accept" : operation === "assignment" ? "assign" : "cancel"};
  if (operation === "schedule") {
    if (!input.date || !input.startTime || !input.endTime) return refuse("Ask for the date, start time and end time before preparing the schedule.");
    body.slot = {date: input.date, timeRange: minutes(input.startTime) < 720 ? "morning" : "afternoon"};
    body.startTime = input.startTime; body.endTime = input.endTime;
  }
  let assignee = "";
  if (operation === "assignment") {
    if (input.assignTo === "owner") { body.assignTo = "owner"; assignee = "the business owner"; }
    else {
      if (!input.staffName) return refuse("Ask which staff member should be assigned, or whether the owner will handle it.");
      const staff = await adminDb.collection("users").where("businessId", "==", owner.businessId).get();
      const found = staff.docs.filter(doc => String(doc.data().fullName ?? "").trim().toLowerCase() === input.staffName!.toLowerCase());
      if (found.length !== 1) return refuse("No single staff member matched that full name. Ask the owner to identify the staff member exactly.");
      body.assignTo = "staff"; body.staffId = found[0].id; assignee = String(found[0].data().fullName);
    }
  }
  const error = await validateVisit(owner, snap, kind, operation, body); if (error) return refuse(error);
  const beforeSlot = row.scheduledSlot as {date?: string} | undefined;
  const before = `${beforeSlot?.date ?? "unscheduled"} ${row.scheduledStartTime ?? ""}–${row.scheduledEndTime ?? ""}, assigned to ${(row.assignedTo as Assignment | undefined)?.name ?? "nobody"}`;
  const change = operation === "schedule" ? `move to ${input.date} ${input.startTime}–${input.endTime}` : operation === "assignment" ? `assign to ${assignee}` : "cancel this visit (keep its history; do not delete it)";
  const summary = `${kind} ${input.reference} for ${(row.customer as {fullName?: string} | undefined)?.fullName ?? "the customer"}: currently ${before}; ${change}. Times use ${owner.timezone || "Australia/Melbourne"}.`;
  return {ok: true, payload: {id: snap.id, kind, operation, reference: input.reference, body, expectedVersion: visitVersion(snap)}, summary};
}

export async function confirmOwnerVisit(owner: ActionOwner, payload: PreparedVisit): Promise<VoiceResult> {
  const snap = await adminDb.collection(collection(payload.kind)).doc(payload.id).get();
  if (visitVersion(snap) !== payload.expectedVersion) return {status: "STALE", message: "The visit changed after the read-back. Prepare it again."};
  const error = await validateVisit(owner, snap, payload.kind, payload.operation, payload.body);
  if (error) return {status: "REJECTED", message: error};
  try {
    const response = await (payload.kind === "job" ? jobApi.PATCH : inspectionApi.PATCH)(new Request(`http://trade.internal/api/${payload.kind === "job" ? "jobs" : "requests"}/${payload.id}`, {
      method: "PATCH", headers: {Authorization: owner.authorization, "Content-Type": "application/json"},
      body: JSON.stringify({...payload.body, expectedVersion: payload.expectedVersion}),
    }), {params: Promise.resolve({id: payload.id})});
    const result = await response.json();
    if (!response.ok || result.ok === false) return {status: response.status >= 500 ? "UNKNOWN" : "REJECTED", message: result.error ?? "The visit could not be changed. Verify in Trade before trying again."};
    return {status: "DONE", message: `${payload.kind} ${payload.reference}: ${payload.operation} saved.`, reference: payload.reference};
  } catch { return {status: "UNKNOWN", message: "The result could not be confirmed. Check the visit in Trade before preparing another change."}; }
}
