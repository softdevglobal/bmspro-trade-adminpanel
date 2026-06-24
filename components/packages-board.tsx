"use client";

import {
  EMPTY_PACKAGE_FORM,
  PackageBuildModal,
  packageBodyFromForm,
  packageFormFromPlan,
  validatePackageForm,
  type PackageFormState,
} from "@/components/package-build-modal";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { formatBillingNote } from "@/lib/subscription-plans/helpers";
import {
  formatLimitLabel,
  formatRenewalLabel,
  planThemeGradient,
  planThemeSurface,
} from "@/lib/subscription-plans/theme";
import type { SubscriptionPlanDisplay } from "@/lib/subscription-plans/display";
import {
  formatBundledSmsInclusionLabel,
  formatMessageQuotaLabel,
  SMS_BUNDLE_RENEWS_NOTE,
} from "@/lib/sms-packages/helpers";
import type { SubscriptionPlan } from "@/lib/subscription-plans/types";
import type { SmsPackage } from "@/lib/sms-packages/types";
import { useCallback, useEffect, useState } from "react";

function PlanShowcaseCard({
  plan,
  onEdit,
}: {
  plan: SubscriptionPlanDisplay;
  onEdit: () => void;
}) {
  const gradient = planThemeGradient(plan.color);

  return (
    <article
      className="group overflow-hidden rounded-2xl border border-stone-200 shadow-sm transition-shadow hover:shadow-md"
    >
      <button
        type="button"
        onClick={onEdit}
        className="block w-full p-0 text-left"
      >
        <div
          className={`relative bg-gradient-to-br ${gradient} px-5 py-6 text-white`}
        >
          {plan.popular ? (
            <span className="absolute right-4 top-4 rounded-full bg-white/25 px-2.5 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide">
              Most Popular
            </span>
          ) : null}
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 shadow-inner">
            <span className="material-symbols-outlined text-[30px]">
              {plan.icon || "inventory_2"}
            </span>
          </div>
          <h3 className="mt-5 font-display text-[18px] font-bold leading-tight">
            {plan.name}
          </h3>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight">
            {plan.priceLabel}
          </p>
          <p className="mt-1 font-body text-[12px] text-white/85">
            {formatRenewalLabel(plan.billingCycle, plan.validityDays)}
          </p>
          <div className="mt-4 flex flex-wrap gap-4 font-body text-[12px] text-white/90">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">groups</span>
              {formatLimitLabel(plan.staff, "Staff", "Staff")}
            </span>
            {plan.bundledSmsPackage ? (
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">sms</span>
                {plan.bundledSmsPackage.name}
              </span>
            ) : null}
          </div>
        </div>
        <div className={`${planThemeSurface(plan.color)} px-5 py-4`}>
          {plan.description ? (
            <p className="font-body text-[13px] leading-relaxed text-on-surface-variant">
              {plan.description}
            </p>
          ) : null}
          {plan.features.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {plan.features.map((feature) => (
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
          {plan.bundledSmsPackage ? (
            <div className="mt-3 rounded-lg border border-teal-200/80 bg-teal-50 px-3 py-2">
              <p className="font-body text-[10px] font-bold uppercase tracking-wide text-teal-800">
                SMS included
              </p>
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                {formatBundledSmsInclusionLabel(
                  plan.bundledSmsPackage.name,
                  plan.bundledSmsPackage.messageQuota,
                )}
              </p>
              <p className="mt-1 font-body text-[11px] text-teal-800/80">
                {SMS_BUNDLE_RENEWS_NOTE}
              </p>
            </div>
          ) : null}
          {!plan.active || plan.hidden ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!plan.active ? (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 font-body text-[10px] font-bold text-stone-600">
                  Inactive
                </span>
              ) : null}
              {plan.hidden ? (
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

function SummaryPlanCard({
  plan,
  tenantCount,
  onEdit,
}: {
  plan: SubscriptionPlanDisplay;
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
        <h3 className="font-display text-[16px] font-semibold text-on-surface">
          {plan.name}
        </h3>
        <p className="mt-1 font-display text-[20px] font-bold text-on-surface">
          {plan.priceLabel}
        </p>
        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
          {formatBillingNote(plan.billingCycle, plan.validityDays)}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 font-body text-[12px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">groups</span>
            {formatLimitLabel(plan.staff, "Staff", "Staff")}
          </span>
          {plan.bundledSmsPackage ? (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">sms</span>
              {plan.bundledSmsPackage.name}
            </span>
          ) : null}
        </div>
      </div>
      <span className="mt-3 inline-flex shrink-0 items-center justify-center self-start rounded-full bg-primary/10 px-3 py-1 font-body text-[12px] font-bold text-primary sm:mt-0 sm:self-center">
        {tenantCount} Tenant{tenantCount === 1 ? "" : "s"}
      </span>
    </button>
  );
}

export function PackagesBoard() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlanDisplay[]>([]);
  const [smsPackages, setSmsPackages] = useState<SmsPackage[]>([]);
  const [tenantCounts, setTenantCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormState>(EMPTY_PACKAGE_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/packages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const smsRes = await fetch("/api/sms-packages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        plans?: SubscriptionPlanDisplay[];
        tenantCounts?: Record<string, number>;
        error?: string;
      }>(res);
      const smsData = await readJsonResponse<{
        ok?: boolean;
        packages?: SmsPackage[];
        error?: string;
      }>(smsRes);
      if (!res.ok || !data.ok) {
        setPlans([]);
        setError(data.error ?? "Could not load packages.");
        return;
      }
      setPlans(data.plans ?? []);
      setTenantCounts(data.tenantCounts ?? {});
      setSmsPackages(smsData.ok ? (smsData.packages ?? []) : []);
    } catch {
      setError("Could not load packages.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_PACKAGE_FORM);
    setModalOpen(true);
  }

  function openEdit(plan: SubscriptionPlan) {
    setEditingId(plan.id);
    setForm(packageFormFromPlan(plan));
    setModalOpen(true);
  }

  async function handleSave() {
    const validationError = validatePackageForm(form);
    if (!user || validationError) {
      if (validationError) setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const isEdit = Boolean(editingId);
      const res = await fetch("/api/packages", {
        method: isEdit ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(packageBodyFromForm(form, editingId ?? undefined)),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save package.");
        return;
      }
      setModalOpen(false);
      await load();
    } catch {
      setError("Could not save package.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!user || !deleteTargetId) return;
    const planId = deleteTargetId;
    setDeleting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/packages?id=${encodeURIComponent(planId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not delete package.");
        return;
      }
      setDeleteTargetId(null);
      if (modalOpen && editingId === planId) setModalOpen(false);
      await load();
    } catch {
      setError("Could not delete package.");
    } finally {
      setDeleting(false);
    }
  }

  const deleteTargetName =
    plans.find((plan) => plan.id === deleteTargetId)?.name?.trim() ||
    form.name.trim() ||
    "this package";

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
          {/* Summary row */}
          <section>
            <div className="mb-4">
              <h2 className="font-display text-[18px] font-semibold text-on-surface">
                Subscription Packages
              </h2>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                Manage subscription plans for workshops
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {plans.map((plan) => (
                <SummaryPlanCard
                  key={plan.id}
                  plan={plan}
                  tenantCount={tenantCounts[plan.id] ?? 0}
                  onEdit={() => openEdit(plan)}
                />
              ))}
            </div>
          </section>

          {/* Available plans showcase */}
          <section>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-[18px] font-semibold text-on-surface">
                Available Plans
              </h2>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1d24] px-4 py-2.5 font-body text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2a2f3a]"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                New Package
              </button>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <PlanShowcaseCard
                  key={plan.id}
                  plan={plan}
                  onEdit={() => openEdit(plan)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <PackageBuildModal
        open={modalOpen}
        editingId={editingId}
        form={form}
        saving={saving}
        smsPackages={smsPackages}
        onClose={() => setModalOpen(false)}
        onSave={() => void handleSave()}
        onFormChange={setForm}
        onDelete={
          editingId ? () => setDeleteTargetId(editingId) : undefined
        }
      />

      <DeleteConfirmModal
        open={deleteTargetId !== null}
        stacked
        title="Delete subscription package?"
        description={`Delete "${deleteTargetName}"? Existing tenants keep their current plan.`}
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
