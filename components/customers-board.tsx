"use client";

import { InspectionRequestCode } from "@/components/inspection-request-code";
import { useAuth } from "@/lib/auth/auth-context";
import { useBookings } from "@/lib/bookings/use-bookings";
import type { BookingDetail } from "@/lib/bookings/types";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import {
  CUSTOMER_WORK_STATUS_LABELS,
  customerWorkInvoiceSummary,
  isCustomerWorkFullyComplete,
  resolveCustomerWorkStatus,
  type CustomerWorkContext,
  type CustomerWorkDisplayStatus,
} from "@/lib/customer/work-status";
import type { InvoiceDetail } from "@/lib/invoices/types";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONE,
} from "@/lib/bookings/types";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  TIME_RANGE_LABELS,
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
} from "@/lib/inspection/types";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import {
  displayBookingCode,
  displayQuotationCode,
} from "@/lib/reference-codes";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type CustomerSummary = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  requestCount: number;
  lastActivity: number;
  requests: InspectionRequestDetail[];
};

const STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  owner_proposed: "bg-violet-50 text-violet-700 border-violet-200",
  scheduled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  awaiting_decision: "bg-orange-50 text-orange-800 border-orange-200",
  cancelled: "bg-stone-100 text-stone-600 border-stone-200",
  completed: "bg-sky-50 text-sky-700 border-sky-200",
};

const WORK_STATUS_TONE: Record<CustomerWorkDisplayStatus, string> = {
  ...STATUS_TONE,
  pending_payment: "bg-amber-50 text-amber-800 border-amber-200",
  job_completed: "bg-sky-50 text-sky-700 border-sky-200",
};

function customerKey(request: InspectionRequestDetail): string {
  const email = request.customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = request.customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${request.customer.fullName.trim().toLowerCase()}`;
}

function buildCustomerSummaries(
  requests: InspectionRequestDetail[],
): CustomerSummary[] {
  const map = new Map<string, CustomerSummary>();

  for (const request of requests) {
    const key = customerKey(request);
    const existing = map.get(key);
    const activity = request.updatedAt ?? request.createdAt ?? 0;

    if (!existing) {
      map.set(key, {
        id: key,
        fullName: request.customer.fullName?.trim() || "Unknown customer",
        email: request.customer.email?.trim() || "",
        phone: request.customer.phone?.trim() || "",
        requestCount: 1,
        lastActivity: activity,
        requests: [request],
      });
      continue;
    }

    existing.requestCount += 1;
    existing.requests.push(request);
    if (activity > existing.lastActivity) {
      existing.lastActivity = activity;
    }
    if (!existing.fullName && request.customer.fullName) {
      existing.fullName = request.customer.fullName.trim();
    }
    if (!existing.email && request.customer.email) {
      existing.email = request.customer.email.trim();
    }
    if (!existing.phone && request.customer.phone) {
      existing.phone = request.customer.phone.trim();
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

function formatWhen(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function requestTitle(request: InspectionRequestDetail): string {
  if (request.requestType === "existing_service") {
    return request.serviceName ?? "Service request";
  }
  return request.customRequest?.title ?? "Custom quotation";
}

function formatAud(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

type JourneyStep = {
  id: string;
  icon: string;
  title: string;
  detail: string | null;
  badge: string | null;
  badgeTone: string | null;
  done: boolean;
};

function buildJourneySteps(
  ctx: CustomerWorkContext,
  timeZone: string | null | undefined,
): JourneyStep[] {
  const { request, booking } = ctx;
  const workStatus = resolveCustomerWorkStatus(ctx);
  const invoiceSummary = customerWorkInvoiceSummary(ctx);
  const jobStatus = booking?.status ?? request.bookingStatus ?? null;
  const steps: JourneyStep[] = [];

  steps.push({
    id: "request",
    icon: "assignment",
    title: "Request submitted",
    detail: requestTitle(request),
    badge: CUSTOMER_WORK_STATUS_LABELS[workStatus],
    badgeTone: WORK_STATUS_TONE[workStatus],
    done: true,
  });

  const inspectionComplete =
    request.status === "completed" ||
    request.status === "awaiting_decision" ||
    !!request.visitEndedAt;
  const inspectionScheduled = !!request.scheduledSlot;

  if (inspectionScheduled || inspectionComplete || request.status === "scheduled") {
    const visitWindow = formatVisitWindow(
      request.scheduledStartTime,
      request.scheduledEndTime,
    );
    const slotLabel = request.scheduledSlot
      ? `${formatSlotDate(request.scheduledSlot.date, timeZone)} · ${TIME_RANGE_LABELS[request.scheduledSlot.timeRange]}`
      : null;

    steps.push({
      id: "inspection",
      icon: inspectionComplete ? "task_alt" : "event_available",
      title: inspectionComplete
        ? "Inspection completed"
        : inspectionScheduled
          ? "Inspection scheduled"
          : "Inspection pending",
      detail: [slotLabel, visitWindow].filter(Boolean).join(" · ") || null,
      badge: inspectionComplete
        ? "Completed"
        : inspectionScheduled
          ? "Scheduled"
          : "Pending",
      badgeTone: inspectionComplete
        ? STATUS_TONE.completed
        : inspectionScheduled
          ? STATUS_TONE.scheduled
          : STATUS_TONE.pending,
      done: inspectionComplete,
    });
  }

  if (request.quotation) {
    const decision = request.quotation.customerDecision;
    const quotationTitle =
      decision === "accepted"
        ? "Quotation accepted"
        : decision === "rejected"
          ? "Quotation rejected"
          : request.quotation.status === "sent"
            ? "Quotation sent"
            : "Quotation created";

    steps.push({
      id: "quotation",
      icon: "request_quote",
      title: quotationTitle,
      detail: [
        displayQuotationCode(request.quotation),
        formatAud(request.quotation.finalPriceAud),
      ]
        .filter((part) => part && part !== "—")
        .join(" · "),
      badge:
        decision === "accepted"
          ? "Accepted"
          : decision === "rejected"
            ? "Rejected"
            : request.quotation.status === "sent"
              ? "Awaiting customer"
              : request.quotation.status ?? null,
      badgeTone:
        decision === "accepted"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : decision === "rejected"
            ? "bg-stone-100 text-stone-600 border-stone-200"
            : "bg-violet-50 text-violet-700 border-violet-200",
      done: decision === "accepted" || decision === "rejected",
    });
  }

  if (request.bookingId || jobStatus) {
    const jobDone = jobStatus === "completed";
    steps.push({
      id: "job",
      icon: "handyman",
      title: jobDone ? "Job completed" : "Job booked",
      detail: request.bookingCode
        ? displayBookingCode({
            id: request.bookingId ?? "",
            bookingCode: request.bookingCode,
          })
        : null,
      badge: jobStatus ? BOOKING_STATUS_LABELS[jobStatus] : null,
      badgeTone: jobStatus ? BOOKING_STATUS_TONE[jobStatus] : null,
      done: jobDone,
    });
  }

  if (invoiceSummary) {
    const paid = invoiceSummary.status === "paid";
    steps.push({
      id: "invoice",
      icon: paid ? "check_circle" : "receipt_long",
      title: paid ? "Work completed" : "Invoice issued",
      detail: [
        paid ? "Invoice paid" : null,
        invoiceSummary.invoiceCode,
        formatAud(invoiceSummary.finalPriceAud),
      ]
        .filter((part) => part && part !== "—")
        .join(" · "),
      badge: paid
        ? "Completed"
        : invoiceSummary.status === "sent"
          ? "Payment pending"
          : invoiceSummary.status,
      badgeTone: paid
        ? STATUS_TONE.completed
        : "bg-amber-50 text-amber-800 border-amber-200",
      done: paid,
    });
  }

  return steps;
}

function resolveDetailLink(ctx: CustomerWorkContext): {
  href: string;
  label: string;
  icon: string;
} {
  const { request } = ctx;
  const jobStatus = ctx.booking?.status ?? request.bookingStatus ?? null;

  if (request.bookingId) {
    return {
      href: `/dashboard/jobs?job=${encodeURIComponent(request.bookingId)}`,
      label: isCustomerWorkFullyComplete(ctx)
        ? "Open completed job"
        : jobStatus === "completed"
          ? "Open job — awaiting payment"
          : "Open job",
      icon: "handyman",
    };
  }
  return {
    href: `/dashboard/requests?request=${encodeURIComponent(request.id)}`,
    label: "Open request",
    icon: "assignment",
  };
}

function buildWorkContext(
  request: InspectionRequestDetail,
  bookingById: ReadonlyMap<string, BookingDetail>,
  invoiceByRequestId: ReadonlyMap<string, InvoiceDetail>,
): CustomerWorkContext {
  const bookingId = request.bookingId?.trim();
  return {
    request,
    booking: bookingId ? bookingById.get(bookingId) ?? null : null,
    invoice: invoiceByRequestId.get(request.id) ?? null,
  };
}

export function CustomersBoard() {
  const { user } = useAuth();
  const { requests, loading, error } = useInspectionRequests();
  const { bookings } = useBookings();
  const [invoices, setInvoices] = useState<InvoiceDetail[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/invoices", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        invoices?: InvoiceDetail[];
      };
      if (response.ok && data.ok) {
        setInvoices(data.invoices ?? []);
      }
    } catch {
      // Keep request-mirrored invoice data when the invoice list cannot load.
    }
  }, [user]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (selectedId) {
      void loadInvoices();
    }
  }, [selectedId, loadInvoices]);

  const bookingById = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  );
  const invoiceByRequestId = useMemo(
    () =>
      new Map(
        invoices.map((invoice) => [invoice.inspectionRequestId, invoice] as const),
      ),
    [invoices],
  );

  const customers = useMemo(
    () => buildCustomerSummaries(requests),
    [requests],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (customer) => {
        const displayPhone = formatAuPhoneDisplay(customer.phone).toLowerCase();
        return (
          customer.fullName.toLowerCase().includes(q) ||
          customer.email.toLowerCase().includes(q) ||
          customer.phone.includes(q) ||
          displayPhone.includes(q)
        );
      },
    );
  }, [customers, query]);

  const selected = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId],
  );

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
      >
        {error}
      </div>
    );
  }

  return (
    <>
      <div className="w-full min-w-0 space-y-4">
        <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 sm:rounded-2xl">
          <label className="sr-only" htmlFor="customer-search">
            Search customers
          </label>
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              id="customer-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or phone"
              className="w-full rounded-xl border border-outline-variant/60 bg-surface-container-low py-2.5 pl-10 pr-3 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <p className="mt-2 font-body text-[12px] text-on-surface-variant">
            {filtered.length} customer{filtered.length === 1 ? "" : "s"} · tap
            a row to open the side preview
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-8 text-center sm:rounded-2xl sm:p-10">
            <span className="material-symbols-outlined text-[36px] text-outline-variant">
              group_off
            </span>
            <p className="mt-3 font-display text-[18px] font-semibold text-on-surface">
              No customers yet
            </p>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              Customers appear here when they submit an request.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((customer) => (
              <li key={customer.id}>
                <CustomerRow
                  customer={customer}
                  isPreviewOpen={selectedId === customer.id}
                  onOpen={() => setSelectedId(customer.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CustomerPreviewDrawer
        customer={selected}
        bookingById={bookingById}
        invoiceByRequestId={invoiceByRequestId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

function CustomerRow({
  customer,
  isPreviewOpen,
  onOpen,
}: {
  customer: CustomerSummary;
  isPreviewOpen: boolean;
  onOpen: () => void;
}) {
  const displayPhone = formatAuPhoneDisplay(customer.phone);
  const contactLine =
    [customer.email, displayPhone].filter(Boolean).join(" · ") ||
    "No contact on file";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full min-w-0 items-center gap-4 rounded-xl border bg-surface-container-lowest p-4 text-left shadow-sm transition-all sm:p-5 ${
        isPreviewOpen
          ? "border-primary/40 ring-2 ring-primary/15"
          : "border-outline-variant/60 hover:border-primary/30 hover:shadow-md"
      }`}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-container font-body text-[16px] font-bold text-on-primary">
        {(customer.fullName[0] ?? "?").toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16px] font-semibold text-on-surface">
          {customer.fullName}
        </span>
        <span className="mt-0.5 block truncate font-body text-[13px] text-on-surface-variant">
          {contactLine}
        </span>
        <span className="mt-2 inline-flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <span className="material-symbols-outlined text-[16px]">
              assignment
            </span>
            {customer.requestCount} request
            {customer.requestCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span>Active {formatWhen(customer.lastActivity)}</span>
        </span>
      </span>
      <span
        className={`material-symbols-outlined shrink-0 text-[22px] transition-colors ${
          isPreviewOpen ? "text-primary" : "text-on-surface-variant group-hover:text-primary"
        }`}
        aria-hidden
      >
        chevron_right
      </span>
    </button>
  );
}

function CustomerPreviewDrawer({
  customer,
  bookingById,
  invoiceByRequestId,
  onClose,
}: {
  customer: CustomerSummary | null;
  bookingById: ReadonlyMap<string, BookingDetail>;
  invoiceByRequestId: ReadonlyMap<string, InvoiceDetail>;
  onClose: () => void;
}) {
  const open = customer !== null;
  useRegisterRightDrawer(open, "sm");

  return (
    <AnimatePresence>
      {open && customer ? (
        <motion.div
          key="customer-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 overflow-hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            key="customer-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Customer preview: ${customer.fullName}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-full flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl will-change-transform sm:max-w-[520px]"
          >
            <CustomerPreviewContent
              customer={customer}
              bookingById={bookingById}
              invoiceByRequestId={invoiceByRequestId}
              onClose={onClose}
            />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CustomerPreviewContent({
  customer,
  bookingById,
  invoiceByRequestId,
  onClose,
}: {
  customer: CustomerSummary;
  bookingById: ReadonlyMap<string, BookingDetail>;
  invoiceByRequestId: ReadonlyMap<string, InvoiceDetail>;
  onClose: () => void;
}) {
  const profile = useBusinessProfile();
  const timeZone = profile?.timezone ?? null;
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const sortedRequests = [...customer.requests].sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  );
  const displayPhone = formatAuPhoneDisplay(customer.phone);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/60 px-4 py-3 sm:px-5">
        <p className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
          Customer preview
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-outline-variant/60 px-4 py-5 sm:px-5">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-container font-display text-[22px] font-bold text-on-primary">
              {(customer.fullName[0] ?? "?").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[20px] font-semibold text-on-surface">
                {customer.fullName}
              </h3>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                Last activity · {formatWhen(customer.lastActivity)}
              </p>
            </div>
          </div>

          <dl className="mt-5 space-y-3">
            <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2.5">
              <dt className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Email
              </dt>
              <dd className="mt-1 break-all font-body text-[14px] font-medium text-on-surface">
                {customer.email || "—"}
              </dd>
            </div>
            <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2.5">
              <dt className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Phone
              </dt>
              <dd className="mt-1 font-body text-[14px] font-medium text-on-surface">
                {displayPhone || "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <h4 className="mb-3 font-body text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
            Work history
          </h4>

          <ul className="space-y-2">
            {sortedRequests.map((request) => {
              const expanded = expandedRequestId === request.id;
              const workCtx = buildWorkContext(
                request,
                bookingById,
                invoiceByRequestId,
              );
              const journeySteps = buildJourneySteps(workCtx, timeZone);
              const detailLink = resolveDetailLink(workCtx);
              const workStatus = resolveCustomerWorkStatus(workCtx);

              return (
                <li key={request.id}>
                  <div
                    className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                      expanded
                        ? "border-primary/30 ring-1 ring-primary/10"
                        : "border-outline-variant/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRequestId((current) =>
                          current === request.id ? null : request.id,
                        )
                      }
                      className="block w-full p-3 text-left transition-colors hover:bg-primary/[0.02]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wider ${WORK_STATUS_TONE[workStatus]}`}
                            >
                              {CUSTOMER_WORK_STATUS_LABELS[workStatus]}
                            </span>
                            <span className="font-body text-[11px] text-on-surface-variant">
                              {formatWhen(request.createdAt ?? 0)}
                            </span>
                          </div>
                          <p className="mt-2 font-body text-[14px] font-semibold text-on-surface">
                            {requestTitle(request)}
                          </p>
                          <p className="mt-0.5 line-clamp-2 font-body text-[12px] text-on-surface-variant">
                            {formatAddress(request.address)}
                          </p>
                          <p className="mt-2">
                            <InspectionRequestCode request={request} />
                          </p>
                        </div>
                        <span
                          className={`material-symbols-outlined shrink-0 text-[22px] text-on-surface-variant transition-transform ${
                            expanded ? "rotate-90 text-primary" : ""
                          }`}
                          aria-hidden
                        >
                          chevron_right
                        </span>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="border-t border-outline-variant/60 bg-surface-container-low/40 px-3 py-3">
                        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                          Full journey
                        </p>
                        <ol className="mt-3 space-y-0">
                          {journeySteps.map((step, index) => (
                            <li key={step.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                                    step.done
                                      ? "border-primary/30 bg-primary/10 text-primary"
                                      : "border-outline-variant/70 bg-surface-container-lowest text-on-surface-variant"
                                  }`}
                                >
                                  <span className="material-symbols-outlined text-[16px]">
                                    {step.icon}
                                  </span>
                                </span>
                                {index < journeySteps.length - 1 ? (
                                  <span
                                    className={`my-1 w-px flex-1 min-h-[20px] ${
                                      step.done ? "bg-primary/25" : "bg-outline-variant/50"
                                    }`}
                                    aria-hidden
                                  />
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1 pb-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-body text-[13px] font-semibold text-on-surface">
                                    {step.title}
                                  </p>
                                  {step.badge ? (
                                    <span
                                      className={`inline-flex rounded-full border px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wider ${
                                        step.badgeTone ?? STATUS_TONE.pending
                                      }`}
                                    >
                                      {step.badge}
                                    </span>
                                  ) : null}
                                </div>
                                {step.detail ? (
                                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                                    {step.detail}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ol>

                        <Link
                          href={detailLink.href}
                          onClick={onClose}
                          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-primary/10"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {detailLink.icon}
                          </span>
                          {detailLink.label}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
