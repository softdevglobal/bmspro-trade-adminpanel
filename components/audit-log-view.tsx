"use client";

import {
  ACTOR_ROLE_LABELS,
  AUDIT_CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  type AuditCategory,
  countAuditEntriesForCategory,
  isBusinessOwnerAuthEntry,
  matchesAuditCategoryFilter,
  normalizeAuditLogEntries,
  type AuditLogEntry,
  type AuditSource,
} from "@/lib/audit/types";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { customerAuth } from "@/lib/firebase/customer-client";
import {
  formatAuditDateTime,
  SUPER_ADMIN_AUDIT_TIMEZONE,
  timezoneLabel,
} from "@/lib/onboarding/tenant-display";
import { useCallback, useEffect, useMemo, useState } from "react";

export type AuditLogScope = "platform" | "tenant" | "customer";

export type AuditLogViewProps = {
  /** Defaults from signed-in role when omitted. */
  scope?: AuditLogScope;
  /** Required for customer scope — ties events to the booking business. */
  bookingSlug?: string;
};

type TenantOption = { id: string; businessName: string };

const AUDIT_LOG_PAGE_SIZE = 20;

const SOURCE_BADGE: Record<AuditSource, string> = {
  customer_portal:
    "bg-tertiary-fixed text-on-tertiary-fixed-variant border border-on-tertiary-fixed-variant/30",
  booking_engine:
    "bg-tertiary-fixed text-on-tertiary-fixed-variant border border-on-tertiary-fixed-variant/30",
  admin_panel:
    "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20",
  mobile_app:
    "bg-secondary-fixed text-on-secondary-fixed-variant border border-on-secondary-fixed-variant/30",
  system:
    "bg-surface-variant text-on-surface-variant border border-outline-variant",
};

export function AuditLogView({
  scope: scopeProp,
  bookingSlug,
}: AuditLogViewProps = {}) {
  const { user, role } = useAuth();
  const scope: AuditLogScope =
    scopeProp ??
    (role === "super_admin"
      ? "platform"
      : role === "business_owner" || role === "staff"
        ? "tenant"
        : "tenant");

  const isPlatform = scope === "platform";
  const isCustomer = scope === "customer";
  const isTenantOwner = scope === "tenant";

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [businessId, setBusinessId] = useState<string>("");
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [source, setSource] = useState<AuditSource | "all">("all");
  const [page, setPage] = useState(1);
  const [displayTimezone, setDisplayTimezone] = useState(() =>
    isPlatform ? SUPER_ADMIN_AUDIT_TIMEZONE : "Australia/Sydney",
  );

  const loadTenants = useCallback(async () => {
    if (!isPlatform || !user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/tenants", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        tenants?: { id: string; businessName?: string }[];
      }>(res);
      if (res.ok && data.ok) {
        setTenants(
          (data.tenants ?? []).map((t) => ({
            id: t.id,
            businessName: t.businessName || "Unnamed business",
          })),
        );
      }
    } catch {
      /* tenant filter is optional — ignore */
    }
  }, [isPlatform, user]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const sessionUser = isCustomer ? customerAuth.currentUser : user;
      if (!sessionUser) {
        setErrorMessage("Please sign in again.");
        setIsLoading(false);
        return;
      }
      const token = await sessionUser.getIdToken();
      const params = new URLSearchParams();
      if (isPlatform && businessId) params.set("businessId", businessId);
      if (isCustomer && bookingSlug?.trim()) {
        params.set("bookingSlug", bookingSlug.trim());
      }
      params.set("limit", "300");

      const res = await fetch(`/api/audit-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        logs?: AuditLogEntry[];
        displayTimezone?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error ?? "Could not load the audit log.");
        setLogs([]);
        setIsLoading(false);
        return;
      }
      setLogs(data.logs ?? []);
      if (typeof data.displayTimezone === "string" && data.displayTimezone) {
        setDisplayTimezone(data.displayTimezone);
      }
    } catch {
      setErrorMessage("Network error loading the audit log.");
    } finally {
      setIsLoading(false);
    }
  }, [businessId, isPlatform, isCustomer, bookingSlug, user]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (isPlatform && category === "staff") {
      setCategory("all");
    }
  }, [isPlatform, category]);

  useEffect(() => {
    setPage(1);
  }, [category, source, businessId]);

  const processedLogs = useMemo(
    () => normalizeAuditLogEntries(logs),
    [logs],
  );

  const tenantOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of tenants) {
      byId.set(t.id, t.businessName);
    }
    for (const entry of processedLogs) {
      if (entry.businessId && entry.businessName) {
        byId.set(entry.businessId, entry.businessName);
      }
    }
    return Array.from(byId.entries())
      .map(([id, businessName]) => ({ id, businessName }))
      .sort((a, b) => a.businessName.localeCompare(b.businessName));
  }, [tenants, processedLogs]);

  const logsForStats = useMemo(
    () =>
      source === "all"
        ? processedLogs
        : processedLogs.filter((entry) => entry.source === source),
    [processedLogs, source],
  );

  const stats = useMemo(() => {
    const byCategory = new Map<AuditCategory, number>();
    for (const cat of AUDIT_CATEGORIES) {
      byCategory.set(
        cat,
        countAuditEntriesForCategory(logsForStats, cat, isTenantOwner),
      );
    }
    return {
      total: logsForStats.length,
      byCategory,
    };
  }, [logsForStats, isTenantOwner]);

  const visibleLogs = useMemo(
    () =>
      logsForStats.filter((entry) =>
        matchesAuditCategoryFilter(entry, category, isTenantOwner),
      ),
    [logsForStats, category, isTenantOwner],
  );

  const totalPages = Math.max(
    1,
    Math.ceil(visibleLogs.length / AUDIT_LOG_PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pageStart =
    visibleLogs.length === 0 ? 0 : (safePage - 1) * AUDIT_LOG_PAGE_SIZE;
  const pageEnd = Math.min(safePage * AUDIT_LOG_PAGE_SIZE, visibleLogs.length);
  const paginatedLogs = visibleLogs.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const categoryOptions = useMemo(() => {
    const categories = AUDIT_CATEGORIES.filter((cat) => {
      if (cat === "staff") return isTenantOwner;
      if (cat === "custom_notification") return isPlatform;
      if (isCustomer) {
        return (
          cat === "auth" ||
          cat === "inspection" ||
          cat === "customer" ||
          cat === "booking" ||
          cat === "quotation"
        );
      }
      return true;
    });

    return [
      { value: "all" as const, label: "All categories", count: stats.total },
      ...categories.map((cat) => ({
        value: cat,
        label: CATEGORY_LABELS[cat],
        count: stats.byCategory.get(cat) ?? 0,
      })),
    ];
  }, [isTenantOwner, isCustomer, isPlatform, stats]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <AuditFilterSelect
          value={category}
          onChange={(value) =>
            setCategory(value as AuditCategory | "all")
          }
          ariaLabel="Filter by category"
          className="sm:w-55"
        >
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </AuditFilterSelect>

        {isPlatform ? (
          <AuditFilterSelect
            value={businessId}
            onChange={(value) => setBusinessId(value)}
            ariaLabel="Filter by tenant"
            className="sm:w-52"
          >
            <option value="">All tenants</option>
            {tenantOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.businessName}
              </option>
            ))}
          </AuditFilterSelect>
        ) : null}

        <AuditFilterSelect
          value={source}
          onChange={(value) => setSource(value as AuditSource | "all")}
          ariaLabel="Filter by source"
          className="sm:w-44"
        >
          <option value="all">All sources</option>
          <option value="customer_portal">Customer portal</option>
          <option value="booking_engine">Booking engine</option>
          {!isCustomer ? (
            <>
              <option value="admin_panel">Admin panel</option>
              <option value="mobile_app">Mobile app</option>
            </>
          ) : null}
          <option value="system">System</option>
        </AuditFilterSelect>

        <button
          type="button"
          onClick={() => void load()}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
        {isLoading ? (
          <div className="px-4 py-12 text-center font-body text-body-md text-on-surface-variant">
            <span className="material-symbols-outlined mr-2 animate-spin align-middle text-[18px]">
              progress_activity
            </span>
            Loading activity…
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <span className="material-symbols-outlined text-[40px] text-outline-variant">
              history
            </span>
            <p className="mt-2 font-body text-body-md text-on-surface-variant">
              No activity recorded yet for this filter.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-outline-variant/60">
              {paginatedLogs.map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  showTenant={isPlatform && !businessId}
                  displayTimezone={displayTimezone}
                />
              ))}
            </ul>
            {visibleLogs.length > AUDIT_LOG_PAGE_SIZE ? (
              <AuditLogPagination
                page={safePage}
                totalPages={totalPages}
                pageStart={pageStart}
                pageEnd={pageEnd}
                totalItems={visibleLogs.length}
                onPageChange={setPage}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function AuditLogPagination({
  page,
  totalPages,
  pageStart,
  pageEnd,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-[12px] text-on-surface-variant">
        Showing {pageStart + 1}–{pageEnd} of {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="material-symbols-outlined text-[18px]">
            chevron_left
          </span>
          Previous
        </button>
        <span className="min-w-[5.5rem] text-center font-body text-[12px] font-medium text-on-surface-variant">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
        >
          Next
          <span className="material-symbols-outlined text-[18px]">
            chevron_right
          </span>
        </button>
      </div>
    </div>
  );
}

function AuditRow({
  entry,
  showTenant,
  displayTimezone,
}: {
  entry: AuditLogEntry;
  showTenant: boolean;
  displayTimezone: string;
}) {
  const actorLabel =
    entry.actorName ||
    entry.actorEmail ||
    ACTOR_ROLE_LABELS[entry.actorRole];

  return (
    <li className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface-container-low/60">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
        <span className="material-symbols-outlined material-symbols-filled text-[20px]">
          {CATEGORY_ICONS[entry.category]}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-surface-variant px-2 py-0.5 font-body text-[11px] font-semibold text-on-surface-variant">
            {CATEGORY_LABELS[entry.category]}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${SOURCE_BADGE[entry.source]}`}
          >
            {SOURCE_LABELS[entry.source]}
          </span>
          {showTenant && entry.businessName ? (
            <span className="inline-flex items-center gap-1 font-body text-[11px] font-medium text-on-surface-variant">
              <span className="material-symbols-outlined text-[13px]">
                domain
              </span>
              {entry.businessName}
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-body text-[14px] text-on-surface">
          {entry.summary}
        </p>
        <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
          {ACTOR_ROLE_LABELS[entry.actorRole]} · {actorLabel}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className="whitespace-nowrap font-body text-[12px] font-medium text-on-surface-variant"
          title={timezoneLabel(displayTimezone)}
        >
          {formatAuditDateTime(entry.createdAt, displayTimezone)}
        </p>
      </div>
    </li>
  );
}

function AuditFilterSelect({
  value,
  onChange,
  ariaLabel,
  className,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`relative flex h-10 w-full shrink-0 items-center ${className ?? ""}`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="h-full w-full appearance-none rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-3 pr-10 font-body text-[13px] font-medium text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {children}
      </select>
      <span className="material-symbols-outlined pointer-events-none absolute right-3 text-[20px] text-outline">
        expand_more
      </span>
    </label>
  );
}

