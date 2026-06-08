"use client";

import { TenantDetailDrawer } from "@/components/tenant-detail-drawer";
import { TenantOnboardModal } from "@/components/tenant-onboard-modal";
import { TenantViewButton } from "@/components/tenant-view-button";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { useCallback, useEffect, useState } from "react";

function ownerLabel(owner: TenantDetail["owner"]): string {
  if (!owner) return "—";
  if (owner.fullName) return owner.fullName;
  return "—";
}

function locationLabel(tenant: TenantDetail): string {
  if (tenant.state && tenant.postcode) return `${tenant.state}, ${tenant.postcode}`;
  return tenant.mainSuburb || "—";
}

const STATUS_BADGE: Record<TenantDetail["status"], string> = {
  pending_review:
    "bg-tertiary-fixed text-on-tertiary-fixed-variant border border-on-tertiary-fixed-variant/30",
  active: "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20",
  suspended:
    "bg-error-container text-on-error-container border border-error/30",
};

const STATUS_LABEL: Record<TenantDetail["status"], string> = {
  pending_review: "Pending review",
  active: "Active",
  suspended: "Suspended",
};

type TenantFilter = "all" | "active" | "suspended";

export function TenantsTable() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<TenantFilter>("all");
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(
    null
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (!user) {
        setErrorMessage("Please sign in again.");
        setIsLoading(false);
        return;
      }
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/tenants", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        tenants?: TenantDetail[];
      }>(response);
      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? "Could not load tenants.");
        setIsLoading(false);
        return;
      }
      setTenants(data.tenants ?? []);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Network error loading tenants.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered =
    filter === "all" ? tenants : tenants.filter((t) => t.status === filter);

  const counts = {
    all: tenants.length,
    active: tenants.filter((t) => t.status === "active").length,
    suspended: tenants.filter((t) => t.status === "suspended").length,
  };

  const showEmptyOnboardCta = filter === "all" || filter === "active";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="All"
            count={counts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label="Active"
            count={counts.active}
            active={filter === "active"}
            onClick={() => setFilter("active")}
          />
          <FilterChip
            label="Suspended"
            count={counts.suspended}
            active={filter === "suspended"}
            onClick={() => setFilter("suspended")}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setOnboardOpen(true)}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Onboard new business
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:hidden">
        {isLoading ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-10 text-center font-body text-body-md text-on-surface-variant">
            <span className="material-symbols-outlined mr-2 animate-spin align-middle text-[18px]">
              progress_activity
            </span>
            Loading tenants...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-10 text-center">
            <p className="font-body text-body-md text-on-surface-variant">
              No tenants
              {filter !== "all"
                ? ` with status “${filter === "active" ? "Active" : "Suspended"}”`
                : ""}{" "}
              yet.
            </p>
            {showEmptyOnboardCta && (
              <button
                type="button"
                onClick={() => setOnboardOpen(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                Onboard new business
              </button>
            )}
          </div>
        ) : (
          filtered.map((tenant) => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              onView={() => setSelectedTenant(tenant)}
            />
          ))
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-body-md">
            <thead className="border-b border-outline-variant bg-surface-container-low text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-5 py-3">Business</th>
                <th className="hidden px-5 py-3 sm:table-cell">Owner</th>
                <th className="hidden px-5 py-3 md:table-cell">Location</th>
                <th className="px-5 py-3">Status</th>
                <th className="hidden px-5 py-3 md:table-cell">Source</th>
                <th className="hidden px-5 py-3 lg:table-cell">Created</th>
                <th className="px-3 py-3 text-right">View</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center font-body text-body-md text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined mr-2 animate-spin align-middle text-[18px]">
                      progress_activity
                    </span>
                    Loading tenants...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center">
                    <p className="font-body text-body-md text-on-surface-variant">
                      No tenants
                      {filter !== "all"
                        ? ` with status “${filter === "active" ? "Active" : "Suspended"}”`
                        : ""}{" "}
                      yet.
                    </p>
                    {showEmptyOnboardCta && (
                      <button
                        type="button"
                        onClick={() => setOnboardOpen(true)}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          add
                        </span>
                        Onboard new business
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-outline-variant/60 last:border-b-0 hover:bg-surface-container-low/60"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                          <span className="material-symbols-outlined material-symbols-filled text-[20px]">
                            {iconForBusinessType(tenant.businessType)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-body text-[14px] font-semibold text-on-surface">
                            {tenant.businessName || "—"}
                          </p>
                          <p className="truncate font-body text-[12px] text-on-surface-variant">
                            {tenant.businessType} · {tenant.businessEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-5 py-4 sm:table-cell">
                      <p className="font-body text-[13px] text-on-surface">
                        {ownerLabel(tenant.owner)}
                      </p>
                      <p className="font-body text-[12px] text-on-surface-variant">
                        {tenant.businessPhone || ""}
                      </p>
                    </td>
                    <td className="hidden px-5 py-4 font-body text-[13px] text-on-surface md:table-cell">
                      {locationLabel(tenant)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${STATUS_BADGE[tenant.status]}`}
                      >
                        {STATUS_LABEL[tenant.status]}
                      </span>
                    </td>
                    <td className="hidden px-5 py-4 font-body text-[13px] text-on-surface-variant md:table-cell">
                      {tenant.source === "self_signup"
                        ? "Self sign-up"
                        : "Super admin"}
                    </td>
                    <td className="hidden px-5 py-4 font-body text-[12px] text-on-surface-variant lg:table-cell">
                      {tenant.createdAt
                        ? new Date(tenant.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-4 text-right">
                      <TenantViewButton
                        tenant={tenant}
                        onClick={() => setSelectedTenant(tenant)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TenantDetailDrawer
        tenant={selectedTenant}
        onClose={() => setSelectedTenant(null)}
      />

      <TenantOnboardModal
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}

function TenantCard({
  tenant,
  onView,
}: {
  tenant: TenantDetail;
  onView: () => void;
}) {
  return (
    <article className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
          <span className="material-symbols-outlined material-symbols-filled text-[22px]">
            {iconForBusinessType(tenant.businessType)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-body text-[15px] font-semibold text-on-surface">
                {tenant.businessName || "—"}
              </h3>
              <p className="mt-0.5 truncate font-body text-[12px] text-on-surface-variant">
                {tenant.businessType} · {tenant.businessEmail}
              </p>
            </div>
            <TenantViewButton tenant={tenant} onClick={onView} />
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 font-body text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Owner</dt>
              <dd className="truncate text-right font-medium text-on-surface">
                {ownerLabel(tenant.owner)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Location</dt>
              <dd className="text-right font-medium text-on-surface">
                {locationLabel(tenant)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Source</dt>
              <dd className="text-right font-medium text-on-surface">
                {tenant.source === "self_signup" ? "Self sign-up" : "Super admin"}
              </dd>
            </div>
            {tenant.createdAt ? (
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Created</dt>
                <dd className="text-right font-medium text-on-surface">
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${STATUS_BADGE[tenant.status]}`}
            >
              {STATUS_LABEL[tenant.status]}
            </span>
            {tenant.businessPhone ? (
              <span className="font-body text-[12px] text-on-surface-variant">
                {tenant.businessPhone}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex h-9 items-center gap-2 rounded-full bg-primary px-3 font-body text-[13px] font-semibold text-on-primary"
          : "flex h-9 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
      }
    >
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
