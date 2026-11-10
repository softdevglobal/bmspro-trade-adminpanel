import "server-only";

import { bookingScheduleDays, mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { listApprovedLeaveForBusiness } from "@/lib/leave/server";
import { platformTodayIso, resolvePlatformTimeZone } from "@/lib/platform/timezone";
import { isStaffOffOnDate, offDayIdsFromAvailability } from "@/lib/team/staff-availability";

export function ownerBriefingTools(businessId: string, timezone: string | null) {
  const timeZone = resolvePlatformTimeZone(timezone);
  const requests = adminDb.collection(REQUESTS_COLLECTION).where("businessId", "==", businessId);
  const jobs = adminDb.collection(JOBS_COLLECTION).where("businessId", "==", businessId);

  async function todaysVisits(date: string) {
    const [jobDocs, inspectionDocs] = await Promise.all([
      jobs.get(),
      requests.where("scheduledSlot.date", "==", date).get(),
    ]);
    const jobVisits = jobDocs.docs.flatMap((doc) => {
      const job = mapBookingDoc(doc.id, doc.data());
      const day = bookingScheduleDays(job).find((visit) => visit.date === date);
      return day ? [{
        code: job.bookingCode, service: job.serviceName, status: job.status,
        startTime: day.startTime, endTime: day.endTime, staffUid: job.assignedTo?.uid,
      }] : [];
    });
    const inspections = inspectionDocs.docs.map((doc) => {
      const inspection = mapInspectionDoc(doc.id, doc.data());
      return {
        code: inspection.requestCode, service: inspection.serviceName ?? inspection.customRequest?.title,
        status: inspection.status, startTime: inspection.scheduledStartTime,
        endTime: inspection.scheduledEndTime, staffUid: inspection.assignedTo?.uid,
      };
    });
    return { jobs: jobVisits, inspections };
  }

  async function pendingJobs() {
    const snapshot = await requests.where("bookingStatus", "==", "awaiting").get();
    return snapshot.docs.flatMap((doc) => {
      const request = mapInspectionDoc(doc.id, doc.data());
      if (request.bookingId || !["completed", "awaiting_decision"].includes(request.status) ||
          request.quotation?.customerDecision !== "accepted") return [];
      return [{
        reference: request.requestCode,
        service: request.serviceName ?? request.customRequest?.title,
        preferredSlots: request.jobPreferredSlots,
        source: request.sophieJobRequest ? "sophie" : "trade",
        reason: request.sophieJobRequest ? doc.get("sophieJobReviewReason") as string | undefined : undefined,
        createdAt: request.createdAt ?? 0,
      }];
    }).sort((left, right) => left.createdAt - right.createdAt);
  }

  return {
    async dailySummary(offset: number) {
      const date = platformTodayIso(new Date(), timeZone);
      const [visits, pending] = await Promise.all([todaysVisits(date), pendingJobs()]);
      const counts = (rows: { status: string }[]) => rows.reduce<Record<string, number>>((totals, row) => {
        totals[row.status] = (totals[row.status] ?? 0) + 1;
        return totals;
      }, {});
      const todaysSchedule = [
        ...visits.jobs.map((visit) => ({ ...visit, kind: "job" })),
        ...visits.inspections.map((visit) => ({ ...visit, kind: "inspection" })),
      ].sort((left, right) => (left.startTime ?? "99:99").localeCompare(right.startTime ?? "99:99"));
      return {
        date, timeZone,
        jobsByStatus: counts(visits.jobs),
        inspectionsByStatus: counts(visits.inspections),
        unassignedVisits: [...visits.jobs, ...visits.inspections].filter((visit) =>
          (visit.status === "scheduled" || visit.status === "ongoing") && !visit.staffUid).length,
        jobsAwaitingScheduling: pending.length,
        visits: todaysSchedule.slice(offset, offset + 10).map(({ staffUid, ...visit }) =>
          ({ ...visit, assigned: Boolean(staffUid) })),
        nextOffset: offset + 10 < todaysSchedule.length ? offset + 10 : null,
      };
    },
    async awaitingScheduling(offset: number) {
      const pending = await pendingJobs();
      return {
        total: pending.length,
        jobs: pending.slice(offset, offset + 10).map(({ reference, service, preferredSlots, source, reason }) =>
          ({ reference, service, preferredSlots, source, reason })),
        nextOffset: offset + 10 < pending.length ? offset + 10 : null,
      };
    },
    async staffWorking(offset: number) {
      const now = new Date();
      const date = platformTodayIso(now, timeZone);
      const [staffDocs, leave, visits] = await Promise.all([
        adminDb.collection("users").where("businessId", "==", businessId).where("role", "==", "staff").get(),
        listApprovedLeaveForBusiness(businessId),
        todaysVisits(date),
      ]);
      const active = staffDocs.docs.filter((doc) => doc.get("isActive") !== false && doc.get("status") !== "inactive");
      const page = active.slice(offset, offset + 10);
      const sessions = page.length
        ? await adminDb.getAll(...page.map((doc) => adminDb.collection("attendance_sessions").doc(doc.id)))
        : [];
      const staff = await Promise.all(page.map(async (doc, index) => {
        const checkInId: unknown = sessions[index].get("checkInId");
        const record = typeof checkInId === "string" && checkInId && !checkInId.includes("/")
          ? (await adminDb.collection("staff_check_ins").doc(checkInId).get()).data() : null;
        const clockedIn = record?.staffId === doc.id && record?.businessId === businessId && !record.checkOutTime;
        const staffLeave = leave.filter((item) => item.requesterUid === doc.id &&
          item.fromDate && item.toDate && item.fromDate <= date && item.toDate >= date);
        return {
          name: doc.get("fullName"),
          offDay: isStaffOffOnDate(offDayIdsFromAvailability(doc.get("availability")), date, timeZone),
          approvedLeave: staffLeave.map((item) => ({
            fullDay: item.isFullDay, startTime: item.startTime, endTime: item.endTime,
          })),
          attendance: clockedIn ? "clocked_in" : "no_open_check_in",
          assignedJobs: visits.jobs.filter((visit) => visit.staffUid === doc.id && visit.status !== "cancelled").length,
          assignedInspections: visits.inspections.filter((visit) => visit.staffUid === doc.id && visit.status !== "cancelled").length,
        };
      }));
      return { date, timeZone, staff, total: active.length, nextOffset: offset + 10 < active.length ? offset + 10 : null };
    },
  };
}
