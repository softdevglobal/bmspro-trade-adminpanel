"use client";

import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  STATUS_LABELS,
  formatAddress,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
} from "@/lib/inspection/types";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";

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

export function CustomersBoard() {
  const { requests, loading, error } = useInspectionRequests();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  onClose,
}: {
  customer: CustomerSummary | null;
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
            <CustomerPreviewContent customer={customer} onClose={onClose} />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CustomerPreviewContent({
  customer,
  onClose,
}: {
  customer: CustomerSummary;
  onClose: () => void;
}) {
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
            Requests
          </h4>

          <ul className="space-y-2">
            {sortedRequests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/dashboard/requests?request=${request.id}`}
                  onClick={onClose}
                  className="block rounded-xl border border-outline-variant/60 bg-white p-3 transition-colors hover:border-primary/30 hover:bg-primary/[0.02]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[request.status]}`}
                    >
                      {STATUS_LABELS[request.status]}
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
                  {request.status === "cancelled" ? (
                    <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2">
                      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-stone-600">
                        Cancelled
                        {request.cancelledAt
                          ? ` · ${formatWhen(request.cancelledAt)}`
                          : ""}
                      </p>
                      {request.ownerNote ? (
                        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                          {request.ownerNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
