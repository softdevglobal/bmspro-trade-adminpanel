"use client";

import {
  EMPTY_SMS_PACKAGE_FORM,
  SmsPackageBuildModal,
  smsPackageBodyFromForm,
  smsPackageFormFromPlan,
  validateSmsPackageForm,
  type SmsPackageFormState,
} from "@/components/sms-package-build-modal";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { formatMessageQuotaLabel } from "@/lib/sms-packages/helpers";
import type { SmsPackage } from "@/lib/sms-packages/types";
import {
  planThemeGradient,
  planThemeSurface,
} from "@/lib/subscription-plans/theme";
import { useCallback, useEffect, useState } from "react";

function SmsPackageShowcaseCard({
  pkg,
  onEdit,
}: {
  pkg: SmsPackage;
  onEdit: () => void;
}) {
  const gradient = planThemeGradient(pkg.color);

  return (
    <article className="group overflow-hidden rounded-2xl border border-stone-200 shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={onEdit} className="block w-full p-0 text-left">
        <div className={`relative bg-gradient-to-br ${gradient} px-5 py-6 text-white`}>
          {pkg.popular ? (
            <span className="absolute right-4 top-4 rounded-full bg-white/25 px-2.5 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide">
              Most Popular
            </span>
          ) : null}
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 shadow-inner">
            <span className="material-symbols-outlined text-[28px]">{pkg.icon || "sms"}</span>
          </div>
          <h3 className="mt-5 font-display text-[18px] font-bold leading-tight">{pkg.name}</h3>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight">{pkg.priceLabel}</p>
          <p className="mt-4 font-body text-[12px] text-white/90">
            {formatMessageQuotaLabel(pkg.messageQuota)}
          </p>
        </div>
        <div className={`${planThemeSurface(pkg.color)} px-5 py-4`}>
          {pkg.description ? (
            <p className="font-body text-[13px] leading-relaxed text-on-surface-variant">
              {pkg.description}
            </p>
          ) : null}
          {pkg.features.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {pkg.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 font-body text-[12px] text-on-surface-variant"
                >
                  <span className="material-symbols-outlined mt-0.5 text-[16px] text-primary">
                    check_circle
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {!pkg.active || pkg.hidden ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!pkg.active ? (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-body text-[10px] font-bold text-stone-600">
                  Inactive
                </span>
              ) : null}
              {pkg.hidden ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-body text-[10px] font-bold text-amber-800">
                  Hidden
                </span>
              ) : null}
            </div>
          ) : null}
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
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full flex-col rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0">
        <h3 className="font-display text-[16px] font-semibold text-on-surface">{pkg.name}</h3>
        <p className="mt-1 font-display text-[20px] font-bold text-on-surface">{pkg.priceLabel}</p>
        <p className="mt-2 font-body text-[12px] text-on-surface-variant">
          {formatMessageQuotaLabel(pkg.messageQuota)}
        </p>
      </div>
      <span className="mt-3 inline-flex shrink-0 items-center justify-center self-start rounded-full bg-teal-500/10 px-3 py-1 font-body text-[12px] font-bold text-teal-700 sm:mt-0 sm:self-center">
        {tenantCount} Tenant{tenantCount === 1 ? "" : "s"}
      </span>
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

  async function handleDelete(packageId: string) {
    if (!user) return;
    if (
      !window.confirm(
        "Delete this SMS package? Existing tenants keep their current SMS allocation.",
      )
    ) {
      return;
    }
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
      if (modalOpen && editingId === packageId) setModalOpen(false);
      await load();
    } catch {
      setError("Could not delete SMS package.");
    }
  }

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
            <div className="grid gap-3 lg:grid-cols-3">
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
            <div className="grid gap-5 lg:grid-cols-3">
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
        onDelete={editingId ? () => void handleDelete(editingId) : undefined}
      />
    </div>
  );
}
