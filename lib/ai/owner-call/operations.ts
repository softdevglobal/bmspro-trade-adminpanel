import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { CALL_LOGS_COLLECTION, toCallLogDetail } from "@/lib/ai/data/call-logs";
import { resolveReportDate } from "@/lib/ai/owner-call/day-activity";
import { bookingScheduleDays, mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import { listBusinessCustomers } from "@/lib/customer/server";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION, type InspectionCustomer } from "@/lib/inspection/types";
import { INVOICE_COLLECTION, mapInvoiceDoc } from "@/lib/invoices/server";
import { mapLeaveDoc } from "@/lib/leave/server";
import { platformTodayIso } from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { QUOTATION_COLLECTION, mapQuotationDoc } from "@/lib/quotations/server";
import { planTradeStaffAssignment } from "@/lib/team/ai-assignment-planner";

const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
const phone = (value?: string | null) => value?.replace(/\D/g, "").replace(/^61(?=\d{9}$)/, "0") ?? "";
const identity = (customer: InspectionCustomer) => {
  const email = normalize(customer.email);
  const mobile = phone(customer.phone);
  const contact = email ? `email:${email}` : mobile ? `phone:${mobile}` : null;
  return contact ? JSON.stringify([normalize(customer.fullName), contact]) : null;
};
const pageSize = 10;

export function ownerOperations(businessId: string, timeZone: string) {
  const owned = (collection: string) => adminDb.collection(collection).where("businessId", "==", businessId);

  return {
    async lookupCustomerJobs(search?: string, offset = 0) {
      const term = normalize(search);
      if (!term) return { status: "SEARCH_REQUIRED" };
      const [customers, jobs, inspections, quotes, invoices] = await Promise.all([
        listBusinessCustomers(businessId),
        owned(JOBS_COLLECTION).get(), owned(REQUESTS_COLLECTION).get(),
        owned(QUOTATION_COLLECTION).get(), owned(INVOICE_COLLECTION).get(),
      ]);
      const rows = [
        ...jobs.docs.map(doc => {
          const job = mapBookingDoc(doc.id, doc.data());
          return { kind: "job", customer: job.customer, reference: job.bookingCode, inspectionId: job.inspectionRequestId,
            status: job.status, service: job.serviceName ?? job.customRequest?.title,
            createdAt: job.createdAt, staff: job.assignedTo?.name, visits: bookingScheduleDays(job).slice(0, 5) };
        }),
        ...inspections.docs.map(doc => {
          const inspection = mapInspectionDoc(doc.id, doc.data());
          return { kind: "inspection", customer: inspection.customer, reference: inspection.requestCode, inspectionId: doc.id,
            status: inspection.status, service: inspection.serviceName ?? inspection.customRequest?.title,
            createdAt: inspection.createdAt, staff: inspection.assignedTo?.name, date: inspection.scheduledSlot?.date };
        }),
        ...quotes.docs.map(doc => {
          const quote = mapQuotationDoc(doc.id, doc.data());
          return { kind: "quote", customer: quote.customer, reference: quote.quotationCode, inspectionId: quote.inspectionRequestId,
            status: quote.status, decision: quote.customerDecision, service: quote.serviceTitle, createdAt: quote.createdAt };
        }),
        ...invoices.docs.map(doc => {
          const invoice = mapInvoiceDoc(doc.id, doc.data());
          return { kind: "invoice", customer: invoice.customer, reference: invoice.invoiceCode, inspectionId: invoice.inspectionRequestId,
            status: invoice.status, service: invoice.serviceTitle, createdAt: invoice.createdAt };
        }),
      ].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const referenceMatches = rows.filter(row => normalize(row.reference) === term);
      const nameMatches = (customer: InspectionCustomer) =>
        normalize(customer.fullName).includes(term) || normalize(customer.email) === term ||
        (/^[+\d\s()-]{6,}$/.test(term) && phone(customer.phone) === phone(term));
      const candidates = new Map<string, { customer: InspectionCustomer; reference?: string | null }>();
      if (referenceMatches.length === 0) {
        for (const row of rows) {
          const key = identity(row.customer) ?? (row.inspectionId ? `inspection:${row.inspectionId}` : `record:${row.kind}:${row.reference ?? candidates.size}`);
          if (nameMatches(row.customer) && !candidates.has(key)) candidates.set(key, row);
        }
        for (const customer of customers) {
          const key = identity(customer) ?? `customer:${customer.uid}`;
          if (nameMatches(customer) && !candidates.has(key)) candidates.set(key, { customer });
        }
      }
      const matches = referenceMatches.length ? referenceMatches : [...candidates.values()];
      if (!matches.length) return { status: "NO_MATCH" };
      if (matches.length > 1) return { status: "AMBIGUOUS", matches: matches.slice(0, pageSize).map(match => ({
        customer: match.customer.fullName, reference: match.reference ?? null,
      })), total: matches.length };
      const match = matches[0];
      const customerKey = identity(match.customer);
      const linkedId = referenceMatches[0]?.inspectionId;
      const history = [
        ...referenceMatches,
        ...rows.filter(row => row !== referenceMatches[0] && (row === match ||
          (customerKey && identity(row.customer) === customerKey) || (linkedId && row.inspectionId === linkedId))),
      ];
      return {
        status: "OK", customer: match.customer.fullName, total: history.length,
        records: history.slice(offset, offset + pageSize).map(({ customer, inspectionId, ...row }) => ({
          ...row, customer: customer.fullName,
        })),
        nextOffset: offset + pageSize < history.length ? offset + pageSize : null,
      };
    },

    async suggestSchedule(date?: string, search?: string, visitType?: "job" | "inspection" | "advice", duration?: number) {
      const now = new Date();
      const today = platformTodayIso(now, timeZone);
      const day = date === "today" ? today : date;
      if (!day || !z.string().date().safeParse(day).success || day < today) return { status: "DATE_REQUIRED" };
      if (!visitType) return { status: "VISIT_TYPE_REQUIRED" };
      const advice = visitType === "advice";
      const term = normalize(search);
      if (!advice && !term) return { status: "SERVICE_REQUIRED" };
      const [business, services] = await Promise.all([
        adminDb.collection("businesses").doc(businessId).get(),
        advice ? null : owned("services").get(),
      ]);
      const settings = business.data();
      if (!settings) return { status: "UNAVAILABLE" };
      const active = services?.docs.filter(doc => doc.get("isActive") === true) ?? [];
      const exact = active.filter(doc => normalize(doc.get("name")) === term);
      const matches = exact.length ? exact : active.filter(doc => normalize(doc.get("name")).includes(term));
      if (!advice && matches.length !== 1) return { status: matches.length ? "AMBIGUOUS" : "NO_SERVICE_MATCH",
        services: matches.slice(0, pageSize).map(doc => doc.get("name")) };
      const service = advice ? null : { ...matches[0].data(), id: matches[0].id };
      const configured = matches[0]?.get("defaultDurationMin");
      const durationMinutes = duration ?? (visitType === "job"
        ? (typeof configured === "number" && configured > 0 ? Math.min(Math.round(configured), 540) : 60)
        : settings.aiInspectionDurationMin ?? 60);
      const [staff, leaves, jobs, requests, closures] = await Promise.all([
        owned("users").get(), owned("leaveRequests").get(), owned(JOBS_COLLECTION).get(),
        owned(REQUESTS_COLLECTION).get(), owned("business_closures").where("date", "==", day).get(),
      ]);
      const input = {
        service, requestType: advice ? "custom_quote" as const : "existing_service" as const,
        staff: staff.docs.map(doc => ({ ...doc.data(), id: doc.id })),
        leave: leaves.docs.map(doc => mapLeaveDoc(doc.id, doc.data())),
        work: [...jobs.docs, ...requests.docs].map(doc => doc.data()),
        closures: closures.docs.map(doc => String(doc.get("date"))), timezone: timeZone,
        workingHours: parseWorkingHoursFromBusiness(settings), now, durationMinutes,
        travelBufferMinutes: settings.aiAssignmentTravelBufferMin ?? 30,
        allowRunPastSession: visitType === "job",
      };
      const plans = (["morning", "afternoon"] as const).map(timeRange =>
        planTradeStaffAssignment({ ...input, slots: [{ date: day, timeRange }] }));
      const suggestions = plans.flatMap(({ assignedTo, aiAssignment }) =>
        assignedTo && aiAssignment.proposedSlot ? [{ staff: assignedTo.name, ...aiAssignment.proposedSlot }] : []);
      return { status: suggestions.length ? "OK" : "NO_AVAILABILITY", date: day, timeZone, durationMinutes,
        reserved: false, suggestions, reasons: [...new Set(plans.filter(plan => !plan.assignedTo).map(plan => plan.aiAssignment.reason))] };
    },

    async quoteFollowUps(search?: string, offset = 0) {
      const term = normalize(search);
      const snapshot = await owned(QUOTATION_COLLECTION).where("status", "==", "sent").get();
      const quotes = snapshot.docs.map(doc => mapQuotationDoc(doc.id, doc.data()))
        .filter(quote => quote.customerDecision === null && (!term || normalize(quote.quotationCode) === term ||
          normalize(quote.customer.fullName).includes(term)))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      return {
        status: "OK", total: quotes.length, nextOffset: offset + pageSize < quotes.length ? offset + pageSize : null,
        quotes: quotes.slice(offset, offset + pageSize).map(quote => ({
          reference: quote.quotationCode, customer: quote.customer.fullName, service: quote.serviceTitle,
          valueAud: quote.finalPriceAud, createdAt: quote.createdAt, validUntil: quote.validUntil,
        })),
      };
    },

    async sophieCallSummaries(date?: string, offset = 0) {
      const resolved = resolveReportDate(date, new Date(), timeZone);
      if (!resolved.ok) return { status: "INVALID_DATE", error: resolved.error };
      const day = resolved.date;
      const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const start = zonedDateTimeToUtcMs(day, "00:00", timeZone);
      const end = zonedDateTimeToUtcMs(nextDay, "00:00", timeZone);
      if (start === null || end === null) return { status: "UNAVAILABLE" };
      const query = owned(CALL_LOGS_COLLECTION).where("startedAt", ">=", Timestamp.fromMillis(start))
        .where("startedAt", "<", Timestamp.fromMillis(end)).orderBy("startedAt", "desc")
        .select("startedAt", "durationMs", "answered", "endReason", "outcome", "outcomes", "transcript", "firstCallerLine");
      const snapshot = await query.offset(offset).limit(pageSize + 1).get();
      const calls = snapshot.docs.slice(0, pageSize).flatMap(doc => {
        const call = toCallLogDetail(doc.id, doc.data());
        if (!call.answered) return [];
        const callerTurns = call.transcript.filter(turn => turn.speaker === "caller");
        const excerpts = [...new Set([
          ...callerTurns.slice(0, 4).map(turn => turn.text),
          ...callerTurns.slice(4).slice(-2).map(turn => turn.text),
          ...(callerTurns.length === 0 && call.firstCallerLine ? [call.firstCallerLine] : []),
        ])].map(line => line.slice(0, 240));
        return [{ startedAt: call.startedAt, durationMs: call.durationMs, outcome: call.outcome,
          verifiedToolOutcomes: call.outcomes, excerpts, endReason: call.endReason }];
      });
      return { status: "OK", date: day, timeZone, calls, nextOffset: snapshot.size > pageSize ? offset + pageSize : null };
    },
  };
}
