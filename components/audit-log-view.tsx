"use client";

import {
  ACTOR_ROLE_LABELS,
  AUDIT_CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  type AuditCategory,
  type AuditLogEntry,
  type AuditSource,
} from "@/lib/audit/types";
import { auth } from "@/lib/firebase/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type TenantOption = { id: string; businessName: string };

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

function relativeTime(millis: number | null): string {
  if (!millis) return "—";
  const diff = Date.now() - millis;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(millis).toLocaleDateString();
}

function fullTimestamp(millis: number | null): string {
  if (!millis) return "Unknown time";
  return new Date(millis).toLocaleString();
}

export function AuditLogView() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [businessId, setBusinessId] = useState<string>("");
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [source, setSource] = useState<AuditSource | "all">("all");

  const loadTenants = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/tenants/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        tenants?: { id: string; businessName?: string }[];
      };
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
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        setErrorMessage("Please sign in again.");
        setIsLoading(false);
        return;
      }
      const token = await user.getIdToken();
      const params = new URLSearchParams();
      if (businessId) params.set("businessId", businessId);
      if (source !== "all") params.set("source", source);
      params.set("limit", "300");

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        logs?: AuditLogEntry[];
      };
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error ?? "Could not load the audit log.");
        setLogs([]);
        setIsLoading(false);
        return;
      }
      setLogs(data.logs ?? []);
    } catch {
      setErrorMessage("Network error loading the audit log.");
    } finally {
      setIsLoading(false);
    }
  }, [businessId, source]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => {
    const byCategory = new Map<AuditCategory, number>();
    let customerPortal = 0;
    let adminPanel = 0;
    for (const entry of logs) {
      byCategory.set(
        entry.category,
        (byCategory.get(entry.category) ?? 0) + 1,
      );
      if (
        entry.source === "customer_portal" ||
        entry.source === "booking_engine"
      ) {
        customerPortal += 1;
      } else if (
        entry.source === "admin_panel" ||
        entry.source === "mobile_app"
      ) {
        adminPanel += 1;
      }
    }
    return { total: logs.length, byCategory, customerPortal, adminPanel };
  }, [logs]);

  const visibleLogs = useMemo(
    () =>
      category === "all"
        ? logs
        : logs.filter((entry) => entry.category === category),
    [logs, category],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon="bar_chart"
          label="Total events"
          value={stats.total}
          tone="primary"
        />
        <StatCard
          icon="public"
          label="Customer portal"
          value={stats.customerPortal}
          tone="tertiary"
        />
        <StatCard
          icon="admin_panel_settings"
          label="Admin panel"
          value={stats.adminPanel}
          tone="primary"
        />
        <StatCard
          icon="event_available"
          label="Inspections"
          value={stats.byCategory.get("inspection") ?? 0}
          tone="secondary"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.businessName}
              </option>
            ))}
          </select>

          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AuditSource | "all")}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All sources</option>
            <option value="customer_portal">Customer portal</option>
            <option value="booking_engine">Booking engine</option>
            <option value="admin_panel">Admin panel</option>
            <option value="mobile_app">Mobile app</option>
            <option value="system">System</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="flex h-10 items-center gap-2 self-start rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <CategoryChip
          label="All"
          icon="apps"
          active={category === "all"}
          count={stats.total}
          onClick={() => setCategory("all")}
        />
        {AUDIT_CATEGORIES.filter(
          (cat) => cat !== "staff", // Staff filter chip hidden for now
        ).map((cat) => (
          <CategoryChip
            key={cat}
            label={CATEGORY_LABELS[cat]}
            icon={CATEGORY_ICONS[cat]}
            active={category === cat}
            count={stats.byCategory.get(cat) ?? 0}
            onClick={() => setCategory(cat)}
          />
        ))}
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
          <ul className="divide-y divide-outline-variant/60">
            {visibleLogs.map((entry) => (
              <AuditRow key={entry.id} entry={entry} showTenant={!businessId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AuditRow({
  entry,
  showTenant,
}: {
  entry: AuditLogEntry;
  showTenant: boolean;
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
          className="font-body text-[12px] font-medium text-on-surface-variant"
          title={fullTimestamp(entry.createdAt)}
        >
          {relativeTime(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "primary" | "secondary" | "tertiary";
}) {
  const toneClass =
    tone === "tertiary"
      ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
      : tone === "secondary"
        ? "bg-secondary-fixed text-on-secondary-fixed-variant"
        : "bg-primary-fixed text-primary";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneClass}`}
      >
        <span className="material-symbols-outlined material-symbols-filled text-[20px]">
          {icon}
        </span>
      </div>
      <div className="min-w-0">
        <p className="font-display text-[20px] font-bold leading-none text-on-surface">
          {value}
        </p>
        <p className="mt-1 truncate font-body text-[12px] text-on-surface-variant">
          {label}
        </p>
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 font-body text-[13px] font-semibold text-on-primary"
          : "flex h-9 items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
      }
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {label}
      <span
        className={
          active
            ? "rounded-full bg-on-primary/20 px-1.5 py-0.5 text-[11px]"
            : "rounded-full bg-surface-variant px-1.5 py-0.5 text-[11px] text-on-surface-variant"
        }
      >
        {count}
      </span>
    </button>
  );
}
