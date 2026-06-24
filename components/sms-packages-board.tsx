"use client";

import {
  EMPTY_SMS_PACKAGE_FORM,
  SmsPackageBuildModal,
  smsPackageBodyFromForm,
  smsPackageFormFromPlan,
  validateSmsPackageForm,
  type SmsPackageFormState,
} from "@/components/sms-package-build-modal";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { formatMessageQuotaLabel } from "@/lib/sms-packages/helpers";
import type { SmsPackage } from "@/lib/sms-packages/types";
import type { PlanThemeId } from "@/lib/subscription-plans/theme";
import { useCallback, useEffect, useState } from "react";

function themeStyles(color: string) {
  const id = (color?.trim().toLowerCase() || "blue") as PlanThemeId;
  const map: Record<
    PlanThemeId,
    { gradient: string; glow: string; icon: string; chip: string }
  > = {
    blue: {
      gradient: "from-blue-500 via-indigo-500 to-violet-600",
      glow: "bg-blue-400/30",
      icon: "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25",
      chip: "bg-blue-500/10 text-blue-700 ring-blue-500/20",
    },
    slate: {
      gradient: "from-slate-500 via-slate-600 to-slate-800",
      glow: "bg-slate-400/25",
      icon: "bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-lg shadow-slate-500/25",
      chip: "bg-slate-500/10 text-slate-700 ring-slate-500/20",
    },
    purple: {
      gradient: "from-violet-500 via-purple-500 to-fuchsia-600",
      glow: "bg-purple-400/30",
      icon: "bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-500/25",
      chip: "bg-purple-500/10 text-purple-700 ring-purple-500/20",
    },
    teal: {
      gradient: "from-emerald-400 via-teal-500 to-cyan-600",
      glow: "bg-teal-400/30",
      icon: "bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/25",
      chip: "bg-teal-500/10 text-teal-700 ring-teal-500/20",
    },
    orange: {
      gradient: "from-amber-400 via-orange-500 to-rose-500",
      glow: "bg-orange-400/30",
      icon: "bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/25",
      chip: "bg-orange-500/10 text-orange-700 ring-orange-500/20",
    },
    cyan: {
      gradient: "from-sky-400 via-cyan-500 to-blue-600",
      glow: "bg-cyan-400/30",
      icon: "bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25",
      chip: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20",
    },
  };
  return map[id] ?? map.blue;
}

function formatQuotaShort(quota: number): string {
  if (quota < 0) return "∞";
  return quota.toLocaleString();
}

function PackageStatusBadges({ pkg }: { pkg: SmsPackage }) {
  if (pkg.active && !pkg.hidden) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {!pkg.active ? (
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-body text-[10px] font-semibold text-stone-600">
          Inactive
        </span>
      ) : null}
      {pkg.hidden ? (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-body text-[10px] font-semibold text-amber-800">
          Hidden
        </span>
      ) : null}
    </div>
  );
}

function SmsPackageShowcaseCard({
  pkg,
  onEdit,
}: {
  pkg: SmsPackage;
  onEdit: () => void;
}) {
  const theme = themeStyles(pkg.color);

  return (
    <article className="group relative">
      <div
        className={`absolute -inset-px rounded-[1.35rem] bg-gradient-to-br opacity-0 blur-sm transition-opacity duration-300 group-hover:opacity-70 ${theme.gradient}`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onEdit}
        className="relative block w-full overflow-hidden rounded-[1.25rem] border border-white/60 bg-white p-0 text-left shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]"
      >
        <div
          className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl ${theme.glow}`}
          aria-hidden
        />

        <div className="relative px-5 pb-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${theme.icon}`}
              >
                <span className="material-symbols-outlined text-[24px]">
                  {pkg.icon || "sms"}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="truncate font-display text-[16px] font-bold tracking-tight text-on-surface">
                  {pkg.name}
                </h3>
                <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
                  {pkg.plan_key || "SMS top-up"}
                </p>
              </div>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-outline-variant/60 bg-surface/80 text-on-surface-variant opacity-0 transition-all group-hover:opacity-100">
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </span>
          </div>

          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="font-body text-[11px] font-medium uppercase tracking-[0.12em] text-on-surface-variant">
                Messages
              </p>
              <p className="mt-1 font-display text-[42px] font-bold leading-none tracking-tight text-on-surface">
                {formatQuotaShort(pkg.messageQuota)}
              </p>
            </div>
            <div
              className={`rounded-2xl px-3 py-2 ring-1 ring-inset ${theme.chip}`}
            >
              <p className="font-body text-[10px] font-semibold uppercase tracking-wide opacity-80">
                Top-up
              </p>
              <p className="font-display text-[18px] font-bold leading-tight">
                {pkg.priceLabel}
              </p>
            </div>
          </div>

          {pkg.popular ? (
            <span
              className={`mt-4 inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${theme.chip}`}
            >
              <span className="material-symbols-outlined text-[14px]">star</span>
              Most popular
            </span>
          ) : null}

          {pkg.description ? (
            <p className="mt-4 line-clamp-2 font-body text-[12px] leading-relaxed text-on-surface-variant">
              {pkg.description}
            </p>
          ) : null}

          {pkg.features.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-dashed border-outline-variant/70 pt-4">
              {pkg.features.slice(0, 3).map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r ${theme.gradient}`}
                  />
                  <span className="line-clamp-1">{feature}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <PackageStatusBadges pkg={pkg} />
            <span className="ml-auto font-body text-[11px] tabular-nums text-on-surface-variant">
              {formatMessageQuotaLabel(pkg.messageQuota)}
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}

function SummarySmsPackageCard({
  pkg,
  tenantCount,
  onEdit,
}: {
  pkg: SmsPackage;
  tenantCount: number;
  onEdit: () => void;
}) {
  const theme = themeStyles(pkg.color);

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group relative w-full overflow-hidden rounded-2xl border border-outline-variant/50 bg-gradient-to-br from-white to-surface-container-lowest p-0 text-left shadow-sm transition-all hover:border-transparent hover:shadow-md"
    >
      <div
        className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80 ${theme.gradient}`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full blur-2xl transition-opacity group-hover:opacity-100 ${theme.glow} opacity-60`}
        aria-hidden
      />

      <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${theme.icon}`}
          >
            <span className="material-symbols-outlined text-[22px]">
              {pkg.icon || "sms"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-display text-[15px] font-bold text-on-surface">
                {pkg.name}
              </h3>
              {pkg.popular ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-body text-[9px] font-bold uppercase text-primary">
                  Popular
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
              {pkg.priceLabel} top-up
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex flex-1 items-center justify-around gap-1 rounded-xl bg-white/80 px-2 py-2 ring-1 ring-outline-variant/40 sm:flex-none sm:gap-4 sm:px-4">
            <div className="text-center">
              <p className="font-display text-[18px] font-bold tabular-nums text-on-surface">
                {formatQuotaShort(pkg.messageQuota)}
              </p>
              <p className="font-body text-[9px] font-medium uppercase tracking-wide text-on-surface-variant">
                SMS
              </p>
            </div>
            <div className="h-8 w-px bg-outline-variant/50" />
            <div className="text-center">
              <p className="font-display text-[18px] font-bold tabular-nums text-on-surface">
                {tenantCount}
              </p>
              <p className="font-body text-[9px] font-medium uppercase tracking-wide text-on-surface-variant">
                Tenants
              </p>
            </div>
          </div>
          <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-on-surface text-on-primary opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
            <span className="material-symbols-outlined text-[18px]">arrow_outward</span>
          </span>
        </div>
      </div>
    </button>
  );
}

export function SmsPackagesBoard() {
  const { user } = useAuth();
  const [packages, setPackages] = useState<SmsPackage[]>([]);
  const [tenantCounts, setTenantCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SmsPackageFormState>(EMPTY_SMS_PACKAGE_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/sms-packages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        packages?: SmsPackage[];
        tenantCounts?: Record<string, number>;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        setPackages([]);
        setError(data.error ?? "Could not load SMS packages.");
        return;
      }
      setPackages(data.packages ?? []);
      setTenantCounts(data.tenantCounts ?? {});
    } catch {
      setError("Could not load SMS packages.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_SMS_PACKAGE_FORM);
    setModalOpen(true);
  }

  function openEdit(pkg: SmsPackage) {
    setEditingId(pkg.id);
    setForm(smsPackageFormFromPlan(pkg));
    setModalOpen(true);
  }

  async function handleSave() {
    const validationError = validateSmsPackageForm(form);
    if (!user || validationError) {
      if (validationError) setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const isEdit = Boolean(editingId);
      const res = await fetch("/api/sms-packages", {
        method: isEdit ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(smsPackageBodyFromForm(form, editingId ?? undefined)),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save SMS package.");
        return;
      }
      setModalOpen(false);
      await load();
    } catch {
      setError("Could not save SMS package.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!user || !deleteTargetId) return;
    const packageId = deleteTargetId;
    setDeleting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/sms-packages?id=${encodeURIComponent(packageId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not delete SMS package.");
        return;
      }
      setDeleteTargetId(null);
      if (modalOpen && editingId === packageId) setModalOpen(false);
      await load();
    } catch {
      setError("Could not delete SMS package.");
    } finally {
      setDeleting(false);
    }
  }

  const deleteTargetName =
    packages.find((pkg) => pkg.id === deleteTargetId)?.name?.trim() ||
    form.name.trim() ||
    "this SMS package";

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
        </div>
      ) : (
        <>
          <section>
            <div className="mb-4">
              <h2 className="font-display text-[18px] font-semibold text-on-surface">
                SMS Packages
              </h2>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                SMS add-ons bundled with subscription plans and assigned to businesses
              </p>
            </div>
            <div className="grid gap-3">
              {packages.map((pkg) => (
                <SummarySmsPackageCard
                  key={pkg.id}
                  pkg={pkg}
                  tenantCount={tenantCounts[pkg.id] ?? 0}
                  onEdit={() => openEdit(pkg)}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-[18px] font-semibold text-on-surface">
                Available SMS Plans
              </h2>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1d24] px-4 py-2.5 font-body text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2a2f3a]"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                New SMS Package
              </button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
              {packages.map((pkg) => (
                <SmsPackageShowcaseCard key={pkg.id} pkg={pkg} onEdit={() => openEdit(pkg)} />
              ))}
            </div>
          </section>
        </>
      )}

      <SmsPackageBuildModal
        open={modalOpen}
        editingId={editingId}
        form={form}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onSave={() => void handleSave()}
        onFormChange={setForm}
        onDelete={editingId ? () => setDeleteTargetId(editingId) : undefined}
      />

      <DeleteConfirmModal
        open={deleteTargetId !== null}
        stacked
        title="Delete SMS package?"
        description={`Delete "${deleteTargetName}"? Existing tenants keep their current SMS allocation.`}
        confirmLabel="Yes, delete"
        cancelLabel="No, cancel"
        isLoading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTargetId(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
