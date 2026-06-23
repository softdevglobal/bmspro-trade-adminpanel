"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { PlanBuildWizardShell, PLAN_WIZARD_FIELD_CLASS, PLAN_WIZARD_TEXTAREA_CLASS } from "@/components/plan-build-wizard-shell";
import { PackageWizardStepIntro } from "@/components/package-wizard-step-intro";
import { useAuth } from "@/lib/auth/auth-context";
import { validatePlanDescription } from "@/lib/subscription-plans/helpers";
import {
  PLAN_THEME_OPTIONS,
  formatLimitLabel,
  formatRenewalLabel,
  planThemeGradient,
  type PlanThemeId,
} from "@/lib/subscription-plans/theme";
import type { BillingCycle, SubscriptionPlan } from "@/lib/subscription-plans/types";
import type { SmsPackage } from "@/lib/sms-packages/types";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const PACKAGE_MAX_STEP = 4;
type PackageStep = 1 | 2 | 3 | 4;

const PACKAGE_STEP_META: Record<PackageStep, { title: string; subtitle: string }> = {
  1: {
    title: "Basic info",
    subtitle: "Set the package name, price, billing cycle, and description.",
  },
  2: {
    title: "Limits & settings",
    subtitle: "Staff limits, trial period, plan key, and bundled SMS package.",
  },
  3: {
    title: "Features & appearance",
    subtitle: "Feature list, theme colour, and package image.",
  },
  4: {
    title: "Review & preview",
    subtitle: "Check how this plan will appear to workshops before saving.",
  },
};

function validatePackageStep(form: PackageFormState, step: PackageStep): string | null {
  if (step === 1) {
    if (!form.name.trim()) return "Package name is required.";
    const description = validatePlanDescription(form.description);
    return description.ok ? null : description.error;
  }
  return null;
}

export type PackageFormState = {
  name: string;
  price: string;
  priceLabel: string;
  staff: string;
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
  smsPackageId: string;
};

export const EMPTY_PACKAGE_FORM: PackageFormState = {
  name: "",
  price: "99",
  priceLabel: "AU$99/28-day",
  staff: "1",
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
  smsPackageId: "",
};

export function packageFormFromPlan(plan: SubscriptionPlan): PackageFormState {
  return {
    name: plan.name,
    price: String(plan.price),
    priceLabel: plan.priceLabel,
    staff: plan.staff < 0 ? "1" : String(plan.staff),
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
    smsPackageId: plan.smsPackageId ?? "",
  };
}

export function validatePackageForm(form: PackageFormState): string | null {
  if (!form.name.trim()) return "Package name is required.";
  const description = validatePlanDescription(form.description);
  return description.ok ? null : description.error;
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
    staff: form.unlimitedStaff ? -1 : Number.parseInt(form.staff, 10) || 1,
    trialDays: Number.parseInt(form.trialDays, 10) || 0,
    plan_key: form.plan_key.trim() || null,
    billingCycle,
    description: form.description.trim(),
    features: form.featuresText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    popular: form.popular,
    active: form.active,
    hidden: form.hidden,
    stripePriceId: null,
    color: form.color,
    image: form.image.trim() || "",
    icon: "inventory_2",
    smsPackageId: form.smsPackageId.trim() || null,
  };
}

type Props = {
  open: boolean;
  editingId: string | null;
  form: PackageFormState;
  saving: boolean;
  smsPackages: SmsPackage[];
  onClose: () => void;
  onSave: () => void;
  onFormChange: (next: PackageFormState) => void;
  onDelete?: () => void;
};

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
  smsPackages,
  onClose,
  onSave,
  onFormChange,
  onDelete,
}: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<PackageStep>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setStepError(null);
    }
  }, [open, editingId]);

  const validityDays = form.billingCycle === "monthly" ? 28 : 7;
  const previewPrice =
    form.priceLabel.trim() ||
    `AU$${Number.parseFloat(form.price) || 0}/${validityDays}-day`;
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

  function handleContinue() {
    setStepError(null);
    const error = validatePackageStep(form, step);
    if (error) {
      setStepError(error);
      return;
    }
    if (step < PACKAGE_MAX_STEP) {
      setStep((current) => (current + 1) as PackageStep);
    }
  }

  function handleBack() {
    setStepError(null);
    if (step > 1) setStep((current) => (current - 1) as PackageStep);
  }

  function handleSubmit() {
    setStepError(null);
    for (let current = 1; current <= PACKAGE_MAX_STEP; current++) {
      const error = validatePackageStep(form, current as PackageStep);
      if (error) {
        setStepError(error);
        setStep(current as PackageStep);
        return;
      }
    }
    const validationError = validatePackageForm(form);
    if (validationError) {
      setStepError(validationError);
      return;
    }
    onSave();
  }

  const selectedSmsPackage = smsPackages.find((pkg) => pkg.id === form.smsPackageId);
  const stepMeta = PACKAGE_STEP_META[step];

  return (
    <PlanBuildWizardShell
      open={open}
      title={editingId ? "Edit subscription package" : "Build new package"}
      subtitle="Create a subscription plan for workshops."
      step={step}
      maxStep={PACKAGE_MAX_STEP}
      stepError={stepError}
      saving={saving}
      editingId={editingId}
      onClose={onClose}
      onBack={handleBack}
      onContinue={handleContinue}
      onSubmit={handleSubmit}
      onDelete={onDelete}
      submitLabel={editingId ? "Save package" : "Create package"}
    >
      <PackageWizardStepIntro
        step={step}
        maxStep={PACKAGE_MAX_STEP}
        title={stepMeta.title}
        subtitle={stepMeta.subtitle}
      />

      {step === 1 ? (
        <div className="space-y-4">
          <label className="block">
            <FieldLabel required>Package name</FieldLabel>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Starter, Pro"
              className={PLAN_WIZARD_FIELD_CLASS}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel required>Price (AUD)</FieldLabel>
              <input
                type="number"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <FieldLabel>Display label</FieldLabel>
              <input
                value={form.priceLabel}
                onChange={(e) => set("priceLabel", e.target.value)}
                placeholder="AU$99/28-day"
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
          </div>
          <div>
            <FieldLabel>Renewal period</FieldLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set("billingCycle", "weekly")}
                className={`rounded-lg border px-3 py-3 text-left transition-all ${
                  form.billingCycle === "weekly"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-outline-variant hover:border-primary/30"
                }`}
              >
                <p className="font-body text-[13px] font-semibold text-on-surface">Weekly</p>
                <p className="font-body text-[11px] text-on-surface-variant">7-day billing cycle</p>
              </button>
              <button
                type="button"
                onClick={() => set("billingCycle", "monthly")}
                className={`rounded-lg border px-3 py-3 text-left transition-all ${
                  form.billingCycle === "monthly"
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-outline-variant hover:border-primary/30"
                }`}
              >
                <p className="font-body text-[13px] font-semibold text-on-surface">Monthly</p>
                <p className="font-body text-[11px] text-on-surface-variant">28-day billing cycle</p>
              </button>
            </div>
          </div>
          <label className="block">
            <FieldLabel required>Description</FieldLabel>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Summarise what this package includes."
              className={PLAN_WIZARD_TEXTAREA_CLASS}
            />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
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
                className={`${PLAN_WIZARD_FIELD_CLASS} pl-10`}
              />
            </div>
            <label className="mt-2 inline-flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.unlimitedStaff}
                onChange={(e) => set("unlimitedStaff", e.target.checked)}
              />
              Unlimited staff
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Free trial</FieldLabel>
              <input
                type="number"
                value={form.trialDays}
                onChange={(e) => set("trialDays", e.target.value)}
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <FieldLabel>Plan key</FieldLabel>
              <input
                value={form.plan_key}
                onChange={(e) => set("plan_key", e.target.value)}
                placeholder="SOLO"
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
          </div>
          <label className="block">
            <FieldLabel>Bundled SMS package</FieldLabel>
            <select
              value={form.smsPackageId}
              onChange={(e) => set("smsPackageId", e.target.value)}
              className={PLAN_WIZARD_FIELD_CLASS}
            >
              <option value="">No SMS package (use default)</option>
              {smsPackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} — {pkg.priceLabel}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <label className="block">
            <FieldLabel>Features</FieldLabel>
            <textarea
              value={form.featuresText}
              onChange={(e) => set("featuresText", e.target.value)}
              rows={5}
              className={PLAN_WIZARD_TEXTAREA_CLASS}
            />
            <p className="mt-1 font-body text-[11px] text-on-surface-variant">
              One feature per line — each becomes a bullet point
            </p>
          </label>
          <div>
            <FieldLabel>Theme colour</FieldLabel>
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
            <FieldLabel>Package image</FieldLabel>
            <div className="mt-2 rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-4">
              {form.image ? (
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.image} alt="Package" className="max-h-24 rounded-lg object-contain" />
                  <button
                    type="button"
                    onClick={() => set("image", "")}
                    className="font-body text-[12px] font-semibold text-error"
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
                <p className="mt-2 text-center font-body text-[11px] text-error">{uploadError}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Visibility & status
            </p>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {form.active ? "Active — visible to workshops" : "Inactive — hidden from signup"}
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.hidden}
                onChange={(e) => set("hidden", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Hidden from public signup
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.popular}
                onChange={(e) => set("popular", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Mark as most popular
            </label>
          </div>

          <div>
            <p className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Live preview
            </p>
            <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-sm">
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
                    <img src={form.image} alt="" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-[26px]">inventory_2</span>
                  )}
                </div>
                <p className="mt-4 font-display text-[16px] font-bold leading-tight">
                  {form.name.trim() || "Package name"}
                </p>
                <p className="mt-1 font-display text-[22px] font-bold">{previewPrice}</p>
                <p className="mt-1 font-body text-[11px] text-white/80">
                  {formatRenewalLabel(form.billingCycle, validityDays)}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 font-body text-[11px] text-white/90">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">groups</span>
                    {formatLimitLabel(staffCount, "Staff")}
                  </span>
                  {selectedSmsPackage ? (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">sms</span>
                      {selectedSmsPackage.name}
                    </span>
                  ) : null}
                </div>
              </div>
              {form.description.trim() ? (
                <p className="px-4 py-3 font-body text-[12px] leading-relaxed text-on-surface-variant">
                  {form.description.trim()}
                </p>
              ) : null}
              {previewFeatures.length > 0 ? (
                <ul className="space-y-2 px-4 pb-4">
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
          </div>
        </div>
      ) : null}
    </PlanBuildWizardShell>
  );
}
