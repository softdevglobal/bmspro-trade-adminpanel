"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import {
  computeSuperAdminOverview,
  type SuperAdminKpi,
} from "@/lib/dashboard/super-admin-stats";
import { formatTenantDate } from "@/lib/onboarding/tenant-display";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUPER_ADMIN_QUICK_ACTIONS = [
  {
    label: "Tenants",
    desc: "Manage businesses",
    icon: "domain",
    href: "/dashboard/tenants",
    tone: "from-primary/15 to-sky-500/5 text-primary",
  },
  {
    label: "Onboard tenant",
    desc: "Create a new business",
    icon: "add_business",
    href: "/dashboard/tenants",
    tone: "from-emerald-500/15 to-emerald-600/5 text-emerald-700",
  },
  {
    label: "Service templates",
    desc: "Global trade catalog",
    icon: "settings_suggest",
    href: "/dashboard/services",
    tone: "from-violet-500/15 to-violet-600/5 text-violet-700",
  },
  {
    label: "Settings",
    desc: "Platform preferences",
    icon: "tune",
    href: "/dashboard/settings",
    tone: "from-slate-500/10 to-slate-600/5 text-slate-700",
  },
] as const;

const KPI_STYLES: Record<
  SuperAdminKpi["accent"],
  { shell: string; icon: string; glow: string }
> = {
  blue: {
    shell:
      "border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-blue-50/80",
    icon: "bg-sky-500 text-white shadow-[0_8px_20px_-8px_rgba(14,165,233,0.65)]",
    glow: "bg-sky-400/20",
  },
  amber: {
    shell:
      "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/70",
    icon: "bg-amber-500 text-white shadow-[0_8px_20px_-8px_rgba(245,158,11,0.65)]",
    glow: "bg-amber-400/20",
  },
  violet: {
    shell:
      "border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/60",
    icon: "bg-violet-500 text-white shadow-[0_8px_20px_-8px_rgba(139,92,246,0.65)]",
    glow: "bg-violet-400/20",
  },
  emerald: {
    shell:
      "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50/70",
    icon: "bg-emerald-500 text-white shadow-[0_8px_20px_-8px_rgba(16,185,129,0.65)]",
    glow: "bg-emerald-400/20",
  },
};

const TENANT_STATUS_LABEL: Record<TenantDetail["status"], string> = {
  pending_review: "Pending review",
  active: "Active",
  suspended: "Suspended",
};

const TENANT_STATUS_CLASS: Record<TenantDetail["status"], string> = {
  pending_review: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  suspended: "bg-stone-100 text-stone-600 border-stone-200",
};

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTodayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SuperAdminDashboardOverview() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [templateCount, setTemplateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [tenantsRes, templatesRes] = await Promise.all([
        fetch("/api/admin/tenants", { headers, cache: "no-store" }),
        fetch("/api/admin/service-templates", { headers, cache: "no-store" }),
      ]);

      const tenantsData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        tenants?: TenantDetail[];
      }>(tenantsRes);
      const templatesData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        templates?: unknown[];
      }>(templatesRes);

      if (!tenantsRes.ok || !tenantsData.ok) {
        throw new Error(tenantsData.error ?? "Could not load tenants.");
      }

      setTenants(tenantsData.tenants ?? []);
      setTemplateCount(
        templatesRes.ok && templatesData.ok
          ? (templatesData.templates?.length ?? 0)
          : 0,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load platform data.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const overview = useMemo(
    () => computeSuperAdminOverview({ tenants, templateCount }),
    [tenants, templateCount],
  );

  const greeting = greetingForHour(new Date().getHours());
  const displayName =
    user?.displayName?.trim() ||
    user?.email?.split("@")[0]?.replace(/[._]/g, " ") ||
    "Super Admin";

  return (
    <div className="space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-[24px] border border-primary/15 bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-5 py-6 text-on-primary shadow-[0_18px_50px_-24px_rgba(0,74,198,0.75)] sm:px-7 sm:py-7"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-1/3 h-28 w-56 rounded-full bg-sky-300/20 blur-3xl"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="font-body text-[12px] font-bold uppercase tracking-[0.18em] text-on-primary/70">
                {formatTodayLabel()} · Platform console
              </p>
              <h1 className="mt-2 font-display text-[28px] font-bold leading-tight sm:text-[34px]">
                {greeting}, {displayName}
              </h1>
              <p className="mt-2 max-w-2xl font-body text-[14px] leading-relaxed text-on-primary/80 sm:text-[15px]">
                {loading
                  ? "Loading platform overview…"
                  : (overview.focusMessage ??
                    "Manage tenants, service templates, and onboarding.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/tenants"
                className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary backdrop-blur-sm transition hover:bg-white/18"
              >
                <span className="material-symbols-outlined text-[18px]">
                  domain
                </span>
                View tenants
              </Link>
              <Link
                href="/dashboard/tenants"
                className="inline-flex items-center gap-2 rounded-full bg-on-primary px-4 py-2.5 font-body text-[13px] font-bold text-primary shadow-lg shadow-black/15 transition hover:brightness-95"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add_business
                </span>
                Onboard tenant
              </Link>
            </div>
          </div>
        </motion.section>

        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
          >
            {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview.kpis.map((card, index) => {
            const style = KPI_STYLES[card.accent];
            return (
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * index }}
                className={`relative overflow-hidden rounded-[22px] border p-5 ${style.shell}`}
              >
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl ${style.glow}`}
                />
                <div className="relative flex items-start justify-between gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl ${style.icon}`}
                  >
                    <span className="material-symbols-outlined text-[22px]">
                      {card.icon}
                    </span>
                  </span>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-right font-body text-[11px] font-semibold text-on-surface-variant">
                    {loading ? "…" : card.trend}
                  </span>
                </div>
                <p className="relative mt-5 font-display text-[34px] font-bold leading-none text-on-surface">
                  {loading ? "—" : card.value}
                </p>
                <p className="relative mt-2 font-body text-[14px] font-medium text-on-surface-variant">
                  {card.label}
                </p>
              </motion.div>
            );
          })}
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="xl:col-span-7 rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[20px] font-bold text-on-surface">
                  Recent tenants
                </h2>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  Latest businesses on the platform
                </p>
              </div>
              <Link
                href="/dashboard/tenants"
                className="font-body text-[12px] font-bold text-primary hover:underline"
              >
                View all
              </Link>
            </div>

            {loading ? (
              <div className="mt-6 space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-2xl bg-surface-container-low"
                  />
                ))}
              </div>
            ) : overview.recentTenants.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-5 py-10 text-center">
                <span className="material-symbols-outlined text-[32px] text-outline">
                  domain_add
                </span>
                <p className="mt-3 font-body text-[14px] text-on-surface-variant">
                  No tenants yet. Onboard your first trade business to get
                  started.
                </p>
                <Link
                  href="/dashboard/tenants"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    add_business
                  </span>
                  Onboard tenant
                </Link>
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {overview.recentTenants.map((tenant) => (
                  <li key={tenant.id}>
                    <Link
                      href="/dashboard/tenants"
                      className="group flex items-center gap-3 rounded-2xl border border-outline-variant/70 bg-gradient-to-r from-surface-container-low to-surface-container-lowest px-4 py-3 transition hover:border-primary/30 hover:shadow-sm"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-[20px]">
                          {iconForBusinessType(tenant.businessType)}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[14px] font-semibold text-on-surface">
                          {tenant.businessName || "Unnamed business"}
                        </p>
                        <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                          {tenant.owner?.fullName ?? tenant.businessEmail} ·{" "}
                          {formatTenantDate(tenant.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wide ${TENANT_STATUS_CLASS[tenant.status]}`}
                      >
                        {TENANT_STATUS_LABEL[tenant.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="xl:col-span-5 rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"
          >
            <h2 className="font-display text-[20px] font-bold text-on-surface">
              Quick launch
            </h2>
            <p className="mt-1 font-body text-[13px] text-on-surface-variant">
              Platform management shortcuts
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SUPER_ADMIN_QUICK_ACTIONS.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className={`group rounded-2xl border border-outline-variant/60 bg-gradient-to-br px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-md ${action.tone}`}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    {action.icon}
                  </span>
                  <p className="mt-3 font-body text-[14px] font-bold text-on-surface">
                    {action.label}
                  </p>
                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                    {action.desc}
                  </p>
                </Link>
              ))}
            </div>
          </motion.section>
        </div>
    </div>
  );
}
