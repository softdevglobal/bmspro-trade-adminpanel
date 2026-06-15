"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { formatBillingNote } from "@/lib/subscription-plans/helpers";
import {
  PLAN_THEME_OPTIONS,
  formatLimitLabel,
  formatRenewalLabel,
  planThemeGradient,
  type PlanThemeId,
} from "@/lib/subscription-plans/theme";
import type { BillingCycle, SubscriptionPlan } from "@/lib/subscription-plans/types";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export type PackageFormState = {
  name: string;
  price: string;
  priceLabel: string;
  branches: string;
  staff: string;
  unlimitedBranches: boolean;
  unlimitedStaff: boolean;
  trialDays: string;
  plan_key: string;
  billingCycle: BillingCycle;
  description: string;
  featuresText: string;
  popular: boolean;
  active: boolean;
  hidden: boolean;
  stripePriceId: string;
  color: PlanThemeId;
  image: string;
};

export const EMPTY_PACKAGE_FORM: PackageFormState = {
  name: "",
  price: "99",
  priceLabel: "AU$99/28-day",
  branches: "1",
  staff: "1",
  unlimitedBranches: false,
  unlimitedStaff: false,
  trialDays: "0",
  plan_key: "SOLO",
  billingCycle: "monthly",
  description: "",
  featuresText:
    "Unlimited Job Cards\nInvoice & Quotation\nInventory Management\nCustomer Management\nReporting & Analytics",
  popular: false,
  active: true,
  hidden: false,
  stripePriceId: "",
  color: "blue",
  image: "",
};

export function packageFormFromPlan(plan: SubscriptionPlan): PackageFormState {
  return {
    name: plan.name,
    price: String(plan.price),
    priceLabel: plan.priceLabel,
    branches: plan.branches < 0 ? "1" : String(plan.branches),
    staff: plan.staff < 0 ? "1" : String(plan.staff),
    unlimitedBranches: plan.branches < 0,
    unlimitedStaff: plan.staff < 0,
    trialDays: String(plan.trialDays),
    plan_key: plan.plan_key ?? "",
    billingCycle: plan.billingCycle,
    description: plan.description ?? "",
    featuresText: plan.features.join("\n"),
    popular: plan.popular,
    active: plan.active,
    hidden: plan.hidden,
    stripePriceId: plan.stripePriceId ?? "",
    color: (plan.color as PlanThemeId) || "blue",
    image: plan.image ?? "",
  };
}

export function packageBodyFromForm(form: PackageFormState, id?: string) {
  const billingCycle = form.billingCycle;
  const validityDays = billingCycle === "monthly" ? 28 : 7;
  const price = Number.parseFloat(form.price) || 0;
  const autoLabel = `AU$${price}/${validityDays}-day`;

  return {
    ...(id ? { id } : {}),
    name: form.name.trim(),
    price,
    priceLabel: form.priceLabel.trim() || autoLabel,
    branches: form.unlimitedBranches
      ? -1
      : Number.parseInt(form.branches, 10) || 1,
    staff: form.unlimitedStaff ? -1 : Number.parseInt(form.staff, 10) || 1,
    trialDays: Number.parseInt(form.trialDays, 10) || 0,
    plan_key: form.plan_key.trim() || null,
    billingCycle,
    description: form.description.trim() || null,
    features: form.featuresText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    popular: form.popular,
    active: form.active,
    hidden: form.hidden,
    stripePriceId: form.stripePriceId.trim() || null,
    color: form.color,
    image: form.image.trim() || "",
    icon: "inventory_2",
  };
}

type Props = {
  open: boolean;
  editingId: string | null;
  form: PackageFormState;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onFormChange: (next: PackageFormState) => void;
  onDelete?: () => void;
};

function SectionTitle({
  icon,
  title,
}: {
  icon: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-stone-100 pb-2">
      <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
      <h3 className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </h3>
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
      {children}
      {required ? <span className="text-error"> *</span> : null}
    </span>
  );
}

export function PackageBuildModal({
  open,
  editingId,
  form,
  saving,
  onClose,
  onSave,
  onFormChange,
  onDelete,
}: Props) {
  const { user } = useAuth();
  const [imageUploading, setImageUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const validityDays = form.billingCycle === "monthly" ? 28 : 7;
  const previewPrice =
    form.priceLabel.trim() ||
    `AU$${Number.parseFloat(form.price) || 0}/${validityDays}-day`;
  const branchCount = form.unlimitedBranches
    ? -1
    : Number.parseInt(form.branches, 10) || 1;
  const staffCount = form.unlimitedStaff
    ? -1
    : Number.parseInt(form.staff, 10) || 1;

  const previewFeatures = useMemo(
    () =>
      form.featuresText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [form.featuresText],
  );

  if (!open) return null;

  async function handleImageUpload(file: File) {
    if (!user) return;
    setImageUploading(true);
    setUploadError(null);
    try {
      const token = await user!.getIdToken();
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uploads/package-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await readJsonResponse<{ ok?: boolean; imageUrl?: string; error?: string }>(res);
      if (!res.ok || !data.ok || !data.imageUrl) {
        setUploadError(data.error ?? "Could not upload image.");
        return;
      }
      onFormChange({ ...form, image: data.imageUrl });
    } catch {
      setUploadError("Could not upload image.");
    } finally {
      setImageUploading(false);
    }
  }

  function set<K extends keyof PackageFormState>(key: K, value: PackageFormState[K]) {
    onFormChange({ ...form, [key]: value });
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 sm:p-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-outline-variant bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 bg-[#1a1d24] px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-[#1a1d24]">
              <span className="material-symbols-outlined text-[24px]">build</span>
            </span>
            <div>
              <h2 className="font-display text-[18px] font-bold text-white sm:text-[20px]">
                {editingId ? "Edit Package" : "Build New Package"}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-white/70">
                Create a subscription plan for workshops
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Form */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="space-y-6">
              <section className="space-y-3">
                <SectionTitle icon="info" title="Basic Info" />
                <label className="block">
                  <FieldLabel required>Package Name</FieldLabel>
                  <input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Starter, Pro"
                    className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-body text-[14px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel required>Price (AUD)</FieldLabel>
                    <input
                      type="number"
                      value={form.price}
                      onChange={(e) => set("price", e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-body text-[14px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Display Label</FieldLabel>
                    <input
                      value={form.priceLabel}
                      onChange={(e) => set("priceLabel", e.target.value)}
                      placeholder="AU$99/28-day"
                      className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-body text-[14px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                    />
                  </label>
                </div>
                <div>
                  <FieldLabel>Renewal Period</FieldLabel>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => set("billingCycle", "weekly")}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        form.billingCycle === "weekly"
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-stone-200 hover:border-primary/30"
                      }`}
                    >
                      <p className="font-body text-[13px] font-semibold text-on-surface">
                        Weekly
                      </p>
                      <p className="font-body text-[11px] text-on-surface-variant">
                        7-day billing cycle
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => set("billingCycle", "monthly")}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        form.billingCycle === "monthly"
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-stone-200 hover:border-primary/30"
                      }`}
                    >
                      <p className="font-body text-[13px] font-semibold text-on-surface">
                        Monthly
                      </p>
                      <p className="font-body text-[11px] text-on-surface-variant">
                        28-day billing cycle
                      </p>
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="tune" title="Plan Limits" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Branches</FieldLabel>
                    <div className="relative mt-1.5">
                      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                        storefront
                      </span>
                      <input
                        type="number"
                        disabled={form.unlimitedBranches}
                        value={form.branches}
                        onChange={(e) => set("branches", e.target.value)}
                        className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-3 font-body text-[14px] disabled:bg-stone-50"
                      />
                    </div>
                    <label className="mt-2 inline-flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={form.unlimitedBranches}
                        onChange={(e) =>
                          set("unlimitedBranches", e.target.checked)
                        }
                      />
                      Unlimited Branches
                    </label>
                  </div>
                  <div>
                    <FieldLabel>Staff</FieldLabel>
                    <div className="relative mt-1.5">
                      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                        groups
                      </span>
                      <input
                        type="number"
                        disabled={form.unlimitedStaff}
                        value={form.staff}
                        onChange={(e) => set("staff", e.target.value)}
                        className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-3 font-body text-[14px] disabled:bg-stone-50"
                      />
                    </div>
                    <label className="mt-2 inline-flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={form.unlimitedStaff}
                        onChange={(e) => set("unlimitedStaff", e.target.checked)}
                      />
                      Unlimited Staff
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="settings" title="Plan Settings" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel>Free Trial</FieldLabel>
                    <div className="relative mt-1.5">
                      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                        schedule
                      </span>
                      <input
                        type="number"
                        value={form.trialDays}
                        onChange={(e) => set("trialDays", e.target.value)}
                        className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-12 font-body text-[14px]"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-body text-[12px] text-on-surface-variant">
                        days
                      </span>
                    </div>
                  </label>
                  <label className="block">
                    <FieldLabel>Plan Key</FieldLabel>
                    <div className="relative mt-1.5">
                      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                        key
                      </span>
                      <input
                        value={form.plan_key}
                        onChange={(e) => set("plan_key", e.target.value)}
                        placeholder="SOLO"
                        className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-3 font-body text-[14px]"
                      />
                    </div>
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="checklist" title="Features" />
                <textarea
                  value={form.featuresText}
                  onChange={(e) => set("featuresText", e.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2.5 font-body text-[14px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
                <p className="font-body text-[11px] text-on-surface-variant">
                  One feature per line — each becomes a bullet point
                </p>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="palette" title="Appearance" />
                <div>
                  <FieldLabel>Theme Color</FieldLabel>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PLAN_THEME_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.label}
                        onClick={() => set("color", opt.id)}
                        className={`h-9 w-9 rounded-full bg-gradient-to-br ${opt.gradient} ring-offset-2 transition-all ${
                          form.color === opt.id
                            ? `ring-2 ${opt.ring}`
                            : "opacity-80 hover:opacity-100"
                        }`}
                        aria-label={opt.label}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <FieldLabel>Package Image</FieldLabel>
                  <div className="mt-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
                    {form.image ? (
                      <div className="flex flex-col items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={form.image}
                          alt="Package"
                          className="max-h-24 rounded-lg object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => set("image", "")}
                          className="font-body text-[12px] font-semibold text-rose-600"
                        >
                          Remove image
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer flex-col items-center gap-2 py-4">
                        <span className="material-symbols-outlined text-[32px] text-outline">
                          {imageUploading ? "progress_activity" : "image"}
                        </span>
                        <span className="font-body text-[13px] font-semibold text-on-surface">
                          {imageUploading ? "Uploading…" : "Upload package image"}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={imageUploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleImageUpload(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                    {uploadError ? (
                      <p className="mt-2 text-center font-body text-[11px] text-rose-600">
                        {uploadError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* Preview */}
          <aside className="w-full shrink-0 border-t border-stone-200 bg-[#f8f7f5] p-5 lg:w-[300px] lg:border-l lg:border-t-0">
            <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Live Preview
            </p>
            <div className="mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
              <div
                className={`relative bg-gradient-to-br ${planThemeGradient(form.color)} px-4 py-5 text-white`}
              >
                {form.popular ? (
                  <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2 py-0.5 font-body text-[10px] font-bold uppercase">
                    Most Popular
                  </span>
                ) : null}
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                  {form.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.image}
                      alt=""
                      className="h-full w-full rounded-xl object-cover"
                    />
                  ) : (
                    <span className="material-symbols-outlined text-[26px]">
                      inventory_2
                    </span>
                  )}
                </div>
                <p className="mt-4 font-display text-[16px] font-bold leading-tight">
                  {form.name.trim() || "Package Name"}
                </p>
                <p className="mt-1 font-display text-[22px] font-bold">
                  {previewPrice}
                </p>
                <p className="mt-1 font-body text-[11px] text-white/80">
                  {formatRenewalLabel(form.billingCycle, validityDays)}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 font-body text-[11px] text-white/90">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">
                      storefront
                    </span>
                    {formatLimitLabel(branchCount, "Branch")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">
                      groups
                    </span>
                    {formatLimitLabel(staffCount, "Staff")}
                  </span>
                </div>
              </div>
              {previewFeatures.length > 0 ? (
                <ul className="space-y-2 px-4 py-3">
                  {previewFeatures.slice(0, 4).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 font-body text-[12px] text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined mt-0.5 text-[14px] text-primary">
                        check_circle
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border border-stone-200 bg-white p-3">
              <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Status
              </p>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 font-body text-[12px]">
                  <span
                    className={`h-2 w-2 rounded-full ${form.active ? "bg-emerald-500" : "bg-stone-400"}`}
                  />
                  {form.active
                    ? "Active — visible to workshops"
                    : "Inactive — hidden from signup"}
                </label>
                <p className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Renewal: {validityDays}-day cycle
                </p>
                <label className="flex items-center gap-2 font-body text-[12px]">
                  <input
                    type="checkbox"
                    checked={form.hidden}
                    onChange={(e) => set("hidden", e.target.checked)}
                  />
                  Hidden from public signup
                </label>
                <label className="flex items-center gap-2 font-body text-[12px]">
                  <input
                    type="checkbox"
                    checked={form.popular}
                    onChange={(e) => set("popular", e.target.checked)}
                  />
                  Mark as most popular
                </label>
              </div>
            </div>
          </aside>
        </div>

        <div className="flex flex-col gap-3 border-t border-stone-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-1.5 font-body text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]">shield</span>
            Changes are saved securely to your database
          </p>
          <div className="flex gap-2">
            {editingId && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-xl border border-rose-200 px-4 py-2.5 font-body text-[13px] font-semibold text-rose-600"
              >
                Delete
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-stone-200 px-5 py-2.5 font-body text-[13px] font-semibold text-on-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !form.name.trim()}
              onClick={onSave}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1a1d24] px-5 py-2.5 font-body text-[13px] font-semibold text-white disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {saving
                ? "Saving…"
                : editingId
                  ? "Save Package"
                  : "Create Package"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
