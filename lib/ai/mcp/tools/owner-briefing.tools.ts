import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { listCallRecordings, recordingConfig } from "@/lib/ai/calls/recordings";
import { ownerOperations } from "@/lib/ai/owner-call/operations";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";

import {
  matchStaff,
  resolveReportDate,
  summarizeDayActivity,
  summarizeStaffDay,
  type ActivityCheckIn,
  type ActivityInspection,
  type ActivityInvoice,
  type ActivityJob,
  type ActivityQuote,
  type ActivityStaff,
  type ScheduledVisit,
} from "@/lib/ai/owner-call/day-activity";
import { AUDIT_COLLECTION } from "@/lib/audit/types";
import { bookingScheduleDays, mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { INVOICE_COLLECTION, listOverdueInvoicePage, mapInvoiceDoc } from "@/lib/invoices/server";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";
import type { InvoiceStatus } from "@/lib/invoices/types";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { QUOTATION_COLLECTION, mapQuotationDoc } from "@/lib/quotations/server";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { listApprovedLeaveForBusiness } from "@/lib/leave/server";
import { PLATFORM_TIME_ZONE, platformTodayIso, resolvePlatformTimeZone } from "@/lib/platform/timezone";
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

  const toMs = (value: unknown): number | null => {
    if (value instanceof Timestamp) return value.toMillis();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  };

  /** Quotes and invoices created in the 180 days before the day (decisions and payments can come later). */
  const since = (date: string) => Timestamp.fromMillis(Date.parse(`${date}T00:00:00Z`) - 180 * 86_400_000);

  async function activityRecords(date: string) {
    const [jobDocs, requestDocs, quoteDocs, invoiceDocs, sentDocs, visits] = await Promise.all([
      jobs.get(),
      requests.get(),
      adminDb.collection(QUOTATION_COLLECTION).where("businessId", "==", businessId)
        .where("createdAt", ">=", since(date)).get(),
      adminDb.collection(INVOICE_COLLECTION).where("businessId", "==", businessId)
        .where("createdAt", ">=", since(date)).get(),
      adminDb.collection(AUDIT_COLLECTION).where("businessId", "==", businessId)
        .where("action", "==", "quotation.sent").get(),
      todaysVisits(date),
    ]);
    const jobRows: ActivityJob[] = jobDocs.docs.map((doc) => {
      const job = mapBookingDoc(doc.id, doc.data());
      return {
        code: job.bookingCode, service: job.serviceName ?? job.customRequest?.title ?? null,
        customer: job.customer?.fullName || null, suburb: job.address?.suburb || null,
        status: job.status, staffUid: job.assignedTo?.uid ?? null, staffName: job.assignedTo?.name ?? null,
        visitStartedAt: job.visitStartedAt, visitEndedAt: job.visitEndedAt,
        cancelledAt: job.cancelledAt, missedAt: job.missedAt, missedReason: job.missedReason,
      };
    });
    const inspectionRows: ActivityInspection[] = requestDocs.docs.map((doc) => {
      const request = mapInspectionDoc(doc.id, doc.data());
      return {
        code: request.requestCode, service: request.serviceName ?? request.customRequest?.title ?? null,
        customer: request.customer?.fullName || null, suburb: request.address?.suburb || null,
        status: request.status, staffUid: request.assignedTo?.uid ?? null, staffName: request.assignedTo?.name ?? null,
        visitStartedAt: request.visitStartedAt, visitEndedAt: request.visitEndedAt,
        cancelledAt: request.cancelledAt, missedAt: null, missedReason: null,
        createdAt: request.createdAt, source: request.createdSource ?? null,
        fromSophie: request.sophieJobRequest === true,
      };
    });
    const quoteRows: ActivityQuote[] = quoteDocs.docs.map((doc) => {
      const quote = mapQuotationDoc(doc.id, doc.data());
      return {
        code: quote.quotationCode, customer: quote.customer?.fullName || null,
        valueAud: quote.finalPriceAud, createdAt: quote.createdAt, createdByUid: quote.createdBy || null,
        customerDecision: quote.customerDecision, customerDecisionAt: quote.customerDecisionAt,
        depositPaidAt: quote.depositPayment?.paidAt ?? null, depositAud: quote.depositPayment?.amountAud ?? 0,
      };
    });
    const invoiceRows: ActivityInvoice[] = invoiceDocs.docs.map((doc) => {
      const invoice = mapInvoiceDoc(doc.id, doc.data());
      return {
        code: invoice.invoiceCode, customer: invoice.customer?.fullName || null,
        status: invoice.status, invoiceDate: invoice.invoiceDate || null, totalAud: invoice.finalPriceAud,
        payments: invoice.payments.map((payment) => ({ amountAud: payment.amountAud, paidAt: payment.paidAt })),
        markedPaidAt: toMs(doc.get("markedPaidAt")),
      };
    });
    const quoteSentAt = sentDocs.docs.map((doc) => {
      const value = doc.get("metadata.finalPriceAud");
      return { at: toMs(doc.get("createdAt")), valueAud: typeof value === "number" ? value : 0 };
    });
    const scheduled: ScheduledVisit[] = [
      ...visits.jobs.map((visit) => ({ kind: "job" as const, code: visit.code, status: visit.status,
        staffUid: visit.staffUid ?? null, startTime: visit.startTime ?? null })),
      ...visits.inspections.map((visit) => ({ kind: "inspection" as const, code: visit.code, status: visit.status,
        staffUid: visit.staffUid ?? null, startTime: visit.startTime ?? null })),
    ];
    return { jobRows, inspectionRows, quoteRows, invoiceRows, quoteSentAt, scheduled };
  }

  async function activeStaff(date: string): Promise<ActivityStaff[]> {
    const [staffDocs, leave] = await Promise.all([
      adminDb.collection("users").where("businessId", "==", businessId).where("role", "==", "staff").get(),
      listApprovedLeaveForBusiness(businessId),
    ]);
    return staffDocs.docs
      .filter((doc) => doc.get("isActive") !== false && doc.get("status") !== "inactive")
      .map((doc) => ({
        uid: doc.id,
        name: String(doc.get("fullName") ?? "Team member"),
        offDay: isStaffOffOnDate(offDayIdsFromAvailability(doc.get("availability")), date, timeZone),
        approvedLeave: leave
          .filter((item) => item.requesterUid === doc.id && item.fromDate && item.toDate &&
            item.fromDate <= date && item.toDate >= date)
          .map((item) => ({ fullDay: item.isFullDay, startTime: item.startTime ?? null, endTime: item.endTime ?? null })),
      }));
  }

  async function checkInsFor(staff: ActivityStaff[]): Promise<ActivityCheckIn[]> {
    const lists = await Promise.all(staff.map((member) =>
      adminDb.collection("staff_check_ins").where("staffId", "==", member.uid)
        .where("businessId", "==", businessId).get()));
    return lists.flatMap((snapshot, index) => snapshot.docs.map((doc) => ({
      staffUid: staff[index].uid,
      checkInAt: toMs(doc.get("checkInTime")),
      checkOutAt: toMs(doc.get("checkOutTime")),
      breakSeconds: typeof doc.get("totalBreakSeconds") === "number" ? doc.get("totalBreakSeconds") : 0,
      workingSeconds: typeof doc.get("workingSeconds") === "number" ? doc.get("workingSeconds") : null,
    })));
  }

  return {
    ...ownerOperations(businessId, timeZone),
    async invoices(offset: number, search?: string, status?: InvoiceStatus) {
      const profile = await getBusinessProfile(businessId);
      if (!profile?.enabledModules.invoices) return { status: "UNAVAILABLE" };
      const snapshot = await adminDb.collection(INVOICE_COLLECTION).where("businessId", "==", businessId).get();
      const query = search?.trim().toLowerCase() || "";
      const matches = snapshot.docs.map(doc => mapInvoiceDoc(doc.id, doc.data()))
        .filter(invoice => (!status || invoice.status === status) && (!query ||
          [invoice.invoiceCode, invoice.customer.fullName].some(value => value.toLowerCase().includes(query))))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
      const counts = { draft: 0, sent: 0, paid: 0, cancelled: 0 };
      for (const invoice of matches) counts[invoice.status]++;
      const now = new Date();
      const pageSize = 8;
      return {
        status: "OK", total: matches.length, counts,
        nextOffset: offset + pageSize < matches.length ? offset + pageSize : null,
        invoices: matches.slice(offset, offset + pageSize).map(invoice => {
          const due = resolveInvoicePaymentDue(invoice, timeZone, now);
          return {
            invoiceCode: invoice.invoiceCode, customerName: invoice.customer.fullName, status: invoice.status,
            invoiceDate: invoice.invoiceDate, dueDate: due.isPayable ? invoice.dueDate : null,
            totalAud: invoice.finalPriceAud, recordedStripePaymentsAud: invoice.amountPaidAud,
            outstandingAud: due.outstandingAud, overdue: due.isOverdue,
          };
        }),
      };
    },
    async overdueInvoices() {
      const profile = await getBusinessProfile(businessId);
      if (!profile?.enabledModules.invoices) return { status: "UNAVAILABLE" };
      const invoices: Awaited<ReturnType<typeof listOverdueInvoicePage>>["invoices"] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await listOverdueInvoicePage(businessId, timeZone, cursor);
        invoices.push(...result.invoices);
        cursor = result.nextCursor ?? undefined;
        if (!cursor) break;
      }
      invoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceCode.localeCompare(b.invoiceCode));
      return {
        status: "OK",
        complete: cursor === undefined,
        overdueCount: invoices.length,
        outstandingAud: invoices.reduce((sum, invoice) => sum + Math.round(invoice.outstandingAud * 100), 0) / 100,
        oldestInvoices: invoices.slice(0, 8).map(({ invoiceCode, dueDate, outstandingAud }) => ({ invoiceCode, dueDate, outstandingAud })),
      };
    },
    async missedCalls(day?: string) {
      // Calls uses Melbourne calendar dates in both the table and its filters.
      const resolved = resolveReportDate(day, new Date(), PLATFORM_TIME_ZONE);
      if (!resolved.ok) return { status: "INVALID_DATE", error: resolved.error };
      const config = recordingConfig();
      const start = zonedDateTimeToUtcMs(resolved.date, "00:00");
      const endMinute = zonedDateTimeToUtcMs(resolved.date, "23:59");
      if (!config || start === null || endMinute === null) return { status: "UNAVAILABLE" };
      const result = await listCallRecordings(config, businessId, 1, { start, end: endMinute + 60_000 }, "missed");
      if (!result.hasRecordingHistory) return { status: "UNAVAILABLE" };
      const formatTime = new Intl.DateTimeFormat("en-AU", { timeZone: PLATFORM_TIME_ZONE, hour: "numeric", minute: "2-digit" });
      return {
        status: "OK", date: resolved.date, pageCount: result.recordings.length,
        hasMore: result.hasMore || result.recordings.length > 10,
        calls: result.recordings.slice(0, 10).map(call => ({
          customerName: call.customerName,
          time: formatTime.format(call.startedAt),
        })),
      };
    },
    /** What happened across the business on a day (work done, quotes, invoices, money). */
    async dayActivity(day: string | undefined) {
      const resolved = resolveReportDate(day, new Date(), timeZone);
      if (!resolved.ok) return { status: "INVALID_DATE", error: resolved.error };
      const records = await activityRecords(resolved.date);
      return summarizeDayActivity({
        date: resolved.date, timeZone,
        jobs: records.jobRows, inspections: records.inspectionRows, quotes: records.quoteRows,
        quoteSentAt: records.quoteSentAt, invoices: records.invoiceRows, scheduled: records.scheduled,
      });
    },
    /** What each staff member (or one named staff member) did on a day. */
    async staffDayReport(day: string | undefined, staffName: string | undefined, offset: number) {
      const resolved = resolveReportDate(day, new Date(), timeZone);
      if (!resolved.ok) return { status: "INVALID_DATE", error: resolved.error };
      const allStaff = await activeStaff(resolved.date);
      const matched = matchStaff(allStaff, staffName);
      if (staffName?.trim() && matched.length === 0) {
        return { status: "NO_MATCH", staffNames: allStaff.map((member) => member.name) };
      }
      const pageStaff = matched.slice(offset, offset + 10);
      const [records, checkIns] = await Promise.all([activityRecords(resolved.date), checkInsFor(pageStaff)]);
      return {
        date: resolved.date, timeZone,
        staff: summarizeStaffDay({
          date: resolved.date, timeZone, now: new Date(), staff: pageStaff, checkIns,
          jobs: records.jobRows, inspections: records.inspectionRows, quotes: records.quoteRows,
          scheduled: records.scheduled,
        }),
        total: matched.length,
        nextOffset: offset + 10 < matched.length ? offset + 10 : null,
      };
    },
    async dailySummary(offset: number, day?: string) {
      const resolved = resolveReportDate(day, new Date(), timeZone);
      if (!resolved.ok) return { status: "INVALID_DATE", error: resolved.error };
      const date = resolved.date;
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
