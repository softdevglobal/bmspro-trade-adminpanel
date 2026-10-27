import type { DocumentData, DocumentReference, Firestore, Transaction, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { mapLeaveDoc } from "@/lib/leave/server";
import { parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import { planTradeStaffAssignment } from "./ai-assignment-planner";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";

/** Commit staff selection and pending request together. Never promotes the request to scheduled. */
export async function createAiAssignedInspection(db: Firestore, ref: DocumentReference, data: DocumentData, assignedBy: "sophie" | "customer_portal" = "sophie", autoConfirm = false) {
  return db.runTransaction(async tx => {
    const guard = db.collection("aiAssignmentGuards").doc(createHash("sha256").update(data.businessId).digest("hex"));
    const [business, service, staff, leaves, jobs, requests, closures] = await Promise.all([
      tx.get(db.collection("businesses").doc(data.businessId)),
      tx.get(db.collection("services").doc(data.serviceId)),
      tx.get(db.collection("users").where("businessId", "==", data.businessId)),
      tx.get(db.collection("leaveRequests").where("businessId", "==", data.businessId)),
      tx.get(db.collection("jobs").where("businessId", "==", data.businessId)),
      tx.get(db.collection("requests").where("businessId", "==", data.businessId)),
      tx.get(db.collection("business_closures").where("businessId", "==", data.businessId)),
      tx.get(guard),
    ]);
    const businessData = business.data();
    const serviceData = service.data();
    if (!businessData || !isTenantAccessAllowed(businessData.status, businessData.isActive) || serviceData?.businessId !== data.businessId) throw new Error("Business or service changed before assignment.");
    const plan = planTradeStaffAssignment({
      service: { ...serviceData, id: service.id }, staff: staff.docs.map(doc => ({ ...doc.data(), id: doc.id })),
      slots: data.preferredSlots, leave: leaves.docs.map(doc => mapLeaveDoc(doc.id, doc.data())),
      work: [...jobs.docs, ...requests.docs].map(doc => doc.data()), closures: closures.docs.map(doc => String(doc.data().date)),
      timezone: businessData.timezone || "Australia/Melbourne", workingHours: parseWorkingHoursFromBusiness(businessData), now: new Date(),
      durationMinutes: businessData.aiInspectionDurationMin ?? 60, travelBufferMinutes: businessData.aiAssignmentTravelBufferMin ?? 30, assignedBy,
    });
    const proposed = plan.aiAssignment.proposedSlot;
    const confirmed = autoConfirm && plan.aiAssignment.status === "assigned" && !!plan.assignedTo && !!proposed;
    const committed = {
      ...data,
      ...plan,
      ...(confirmed ? {
        status: "scheduled",
        scheduledSlot: { date: proposed.date, timeRange: proposed.timeRange },
        scheduledStartTime: proposed.startTime,
        scheduledEndTime: proposed.endTime,
        aiBookingConfirmedBy: "sophie",
        aiBookingConfirmedAt: new Date(),
      } : {}),
      aiAssignment: { ...plan.aiAssignment, ...(confirmed ? { reason: "Staff and visit time confirmed by Sophie under the business owner's permission." } : {}), evaluatedAt: new Date(), version: 1 },
    };
    tx.set(guard, { updatedAt: new Date() });
    tx.create(ref, committed);
    return committed;
  });
}

/** Recheck an AI-selected inspector when an owner confirms or changes the visit time. */
export async function commitAiInspectionApproval(db: Firestore, ref: DocumentReference, version: Timestamp, updates: DocumentData): Promise<boolean> {
  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref), current = snap.data();
    if (!current || !snap.updateTime?.isEqual(version) || !current.assignedTo?.uid) return false;
    const [business, service, staff, leaves, jobs, requests, closures] = await Promise.all([
      tx.get(db.collection("businesses").doc(current.businessId)), tx.get(db.collection("services").doc(current.serviceId)),
      tx.get(db.collection("users").where("businessId", "==", current.businessId)),
      tx.get(db.collection("leaveRequests").where("businessId", "==", current.businessId)),
      tx.get(db.collection("jobs").where("businessId", "==", current.businessId)),
      tx.get(db.collection("requests").where("businessId", "==", current.businessId)),
      tx.get(db.collection("business_closures").where("businessId", "==", current.businessId)),
    ]);
    const data = business.data();
    if (!data || !isTenantAccessAllowed(data.status, data.isActive) || service.data()?.businessId !== current.businessId) return false;
    const start = updates.scheduledStartTime as string, end = updates.scheduledEndTime as string;
    const slot = updates.scheduledSlot || current.scheduledSlot;
    if (!slot) return false;
    const minutes = (value: string) => Number(value?.slice(0, 2)) * 60 + Number(value?.slice(3));
    const hours = parseWorkingHoursFromBusiness(data);
    if (minutes(start) < minutes(hours.startTime) || minutes(end) > minutes(hours.endTime)) return false;
    const plan = planTradeStaffAssignment({
      service: { ...service.data(), id: service.id }, staff: staff.docs.filter(doc => doc.id === current.assignedTo.uid).map(doc => ({ ...doc.data(), id: doc.id })), slots: [slot],
      leave: leaves.docs.map(doc => mapLeaveDoc(doc.id, doc.data())), work: [...jobs.docs, ...requests.docs.filter(doc => doc.id !== ref.id)].map(doc => doc.data()),
      closures: closures.docs.map(doc => String(doc.data().date)), timezone: data.timezone || "Australia/Melbourne", now: new Date(),
      workingHours: { startTime: start, endTime: end }, durationMinutes: minutes(end) - minutes(start), travelBufferMinutes: data.aiAssignmentTravelBufferMin ?? 30,
    });
    if (plan.assignedTo?.uid !== current.assignedTo.uid || plan.aiAssignment.proposedSlot?.startTime !== start || plan.aiAssignment.proposedSlot?.endTime !== end) return false;
    tx.update(ref, updates);
    return true;
  });
}
