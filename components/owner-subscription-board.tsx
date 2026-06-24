"use client";

import { CheckoutConfirmModal } from "@/components/checkout-confirm-modal";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { useTenantSubscription } from "@/lib/subscription/tenant-subscription-context";
import {
  formatMessageQuotaLabel,
  SMS_BUNDLE_RENEWS_NOTE,
} from "@/lib/sms-packages/helpers";
import { isStripeCheckoutEnabled } from "@/lib/stripe/public";
import { useStripeCheckoutReturn } from "@/lib/stripe/use-stripe-checkout-return";
import {
  formatLimitLabel,
  formatRenewalLabel,
  type PlanThemeId,
} from "@/lib/subscription-plans/theme";
import { isTrialCalendarActive, isTrialEndedRequiringPayment } from "@/lib/subscription-plans/access";
import type {
  AvailablePlanOption,
  TenantSubscriptionSnapshot,
} from "@/lib/subscription-plans/tenant-types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatLongDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysRemaining(untilMs: number | null): number | null {
  if (!untilMs) return null;
  return Math.max(0, Math.ceil((untilMs - Date.now()) / DAY_MS));
}

function trialProgress(subscription: TenantSubscriptionSnapshot): {
  totalDays: number;
  daysLeft: number;
  percent: number;
} {
  const end = subscription.trialEnd;
  const start = subscription.trialStart;
  const daysLeft = daysRemaining(end) ?? 0;
  let totalDays = subscription.trialDays;
  if (start && end && end > start) {
    totalDays = Math.max(1, Math.ceil((end - start) / DAY_MS));
  }
  const daysElapsed = Math.max(0, totalDays - daysLeft);
  const percent =
    totalDays > 0 ? Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100)) : 0;
  return { totalDays, daysLeft, percent };
}

function renewalProgress(subscription: TenantSubscriptionSnapshot): {
  daysLeft: number;
  percent: number;
} {
  const start = subscription.subscriptionPeriodStart;
  const end = subscription.subscriptionPeriodEnd;
  const daysLeft = daysRemaining(end) ?? 0;
  if (!start || !end || end <= start) {
    return { daysLeft, percent: 0 };
  }
  const totalMs = end - start;
  const elapsedMs = Math.min(totalMs, Math.max(0, Date.now() - start));
  return {
    daysLeft,
    percent: Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)),
  };
}

function SubscriptionRenewalBanner({
  subscription,
  stripeEnabled,
  addingPayment,
  onAddPayment,
  onManagePayment,
}: {
  subscription: TenantSubscriptionSnapshot;
  stripeEnabled: boolean;
  addingPayment: boolean;
  onAddPayment: () => void;
  onManagePayment: () => void;
}) {
  const bundled = subscription.bundledSmsPackage;
  const smsRenewDate =
    subscription.smsBundlePeriodEnd ?? subscription.subscriptionPeriodEnd;

  if (subscription.accessBlocked) {
    const trialEnded = isTrialEndedRequiringPayment(subscription);

    return (
      <section className="overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <span className="material-symbols-outlined text-[22px]">
                  event_busy
                </span>
              </span>
              <div>
                <h2 className="font-display text-[18px] font-bold text-on-surface sm:text-[20px]">
                  {trialEnded ? "Free trial ended" : "Subscription ended"}
                </h2>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  {trialEnded
                    ? `Your trial ended on ${formatLongDate(subscription.trialEnd)}. Pay and renew to restore access to your workshop dashboard.`
                    : subscription.subscriptionPeriodEnd
                      ? `Your subscription period ended on ${formatLongDate(subscription.subscriptionPeriodEnd)}. Renew to restore access.`
                      : "Your subscription period has ended. Renew to restore access."}
                </p>
                {subscription.planName ? (
                  <p className="mt-2 font-body text-[12px] text-on-surface-variant">
                    Previous plan:{" "}
                    <span className="font-semibold text-on-surface">
                      {subscription.planName}
                    </span>
                    {subscription.planPriceLabel
                      ? ` · ${subscription.planPriceLabel}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {stripeEnabled && isStripeCheckoutEnabled() ? (
            subscription.stripeSubscriptionId ? (
              <div className="flex shrink-0 flex-col gap-2 self-start">
                <button
                  type="button"
                  disabled={addingPayment}
                  onClick={onAddPayment}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a1d24] px-5 py-3 font-body text-[13px] font-semibold text-white shadow-sm hover:bg-[#2a2f3a] disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {addingPayment ? "progress_activity" : "autorenew"}
                  </span>
                  {addingPayment ? "Starting…" : "Renew subscription"}
                </button>
                <button
                  type="button"
                  onClick={onManagePayment}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant bg-white px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    credit_card
                  </span>
                  Manage payment
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={addingPayment}
                onClick={onAddPayment}
                className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-[#1a1d24] px-5 py-3 font-body text-[13px] font-semibold text-white shadow-sm hover:bg-[#2a2f3a] disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {addingPayment ? "progress_activity" : "credit_card"}
                </span>
                {addingPayment ? "Starting…" : "Pay & renew"}
              </button>
            )
          ) : null}
        </div>
      </section>
    );
  }

  if (
    subscription.isTrialing &&
    isTrialCalendarActive({ trialEnd: subscription.trialEnd })
  ) {
    const { totalDays, daysLeft, percent } = trialProgress(subscription);

    return (
      <section className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <span className="material-symbols-outlined text-[22px]">redeem</span>
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-[18px] font-bold leading-snug text-on-surface sm:text-[20px]">
                  Free Trial Active — {daysLeft} Day{daysLeft === 1 ? "" : "s"}{" "}
                  Remaining
                </h2>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  Trial ends on {formatLongDate(subscription.trialEnd)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2.5">
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-sky-700">
                info
              </span>
              <div className="font-body text-[12px] leading-relaxed text-sky-950">
                <p className="font-semibold">No payment required during your trial</p>
                <p className="mt-1 text-sky-900/90">
                  Use the full dashboard until{" "}
                  {formatLongDate(subscription.trialEnd)}. After your trial ends,
                  you&apos;ll be asked to pay and renew through Stripe to keep
                  access.
                </p>
              </div>
            </div>

            {bundled ? (
              <div className="mt-4 rounded-xl border border-teal-200/80 bg-teal-50/70 px-3 py-2.5">
                <p className="font-body text-[11px] font-bold uppercase tracking-wide text-teal-800">
                  SMS included with your plan
                </p>
                <p className="mt-1 font-body text-[13px] text-on-surface">
                  <span className="font-semibold">{bundled.name}</span>
                  {" — "}
                  {formatMessageQuotaLabel(bundled.messageQuota)} included
                </p>
                <p className="mt-1 font-body text-[11px] text-teal-800/85">
                  {SMS_BUNDLE_RENEWS_NOTE} once billing starts.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-outline-variant/60 bg-white px-5 py-4 sm:px-6">
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between font-body text-[11px] text-on-surface-variant">
            <span>Trial Started</span>
            <span className="font-semibold text-on-surface">
              {daysLeft} of {totalDays} days remaining
            </span>
            <span>Trial Ends</span>
          </div>
        </div>
      </section>
    );
  }

  if (subscription.needsPaymentDetails) {
    return (
      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                <span className="material-symbols-outlined text-[22px]">
                  payments
                </span>
              </span>
              <div>
                <h2 className="font-display text-[18px] font-bold text-on-surface">
                  Payment required
                </h2>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  Add payment details to activate{" "}
                  {subscription.planName ?? "your plan"}.
                </p>
              </div>
            </div>
            {bundled ? (
              <div className="mt-4 rounded-xl border border-teal-200/80 bg-teal-50/70 px-3 py-2.5">
                <p className="font-body text-[11px] font-bold uppercase tracking-wide text-teal-800">
                  SMS included with your plan
                </p>
                <p className="mt-1 font-body text-[13px] text-on-surface">
                  <span className="font-semibold">{bundled.name}</span>
                  {" — "}
                  {formatMessageQuotaLabel(bundled.messageQuota)} included
                </p>
              </div>
            ) : null}
          </div>
          {stripeEnabled && isStripeCheckoutEnabled() ? (
            <button
              type="button"
              disabled={addingPayment}
              onClick={onAddPayment}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-[#1a1d24] px-5 py-3 font-body text-[13px] font-semibold text-white shadow-sm hover:bg-[#2a2f3a] disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">
                {addingPayment ? "progress_activity" : "credit_card"}
              </span>
              {addingPayment ? "Starting…" : "Add Payment Details"}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const { daysLeft, percent } = renewalProgress(subscription);
  const staffLabel =
    subscription.staffLimit < 0
      ? "Unlimited staff"
      : `${subscription.staffCount} of ${subscription.staffLimit} staff used`;
  const staffOverLimit =
    subscription.staffLimit >= 0 &&
    subscription.staffCount > subscription.staffLimit;

  return (
    <section className="overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[22px]">
                workspace_premium
              </span>
            </span>
            <div className="min-w-0">
              <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Current plan
              </p>
              <h2 className="font-display text-[22px] font-bold leading-tight text-on-surface">
                {subscription.planName ?? "No plan"}
              </h2>
              {subscription.planPriceLabel ? (
                <p className="mt-1 font-body text-[14px] text-on-surface-variant">
                  {subscription.planPriceLabel}
                </p>
              ) : null}
              <p className="mt-2 font-body text-[13px] text-on-surface-variant">
                Renews {formatShortDate(subscription.subscriptionPeriodEnd)}
                {daysLeft > 0 ? ` · ${daysLeft} days left` : ""}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
              <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Staff usage
              </p>
              <p
                className={`mt-1 font-display text-[18px] font-bold tabular-nums ${
                  staffOverLimit ? "text-rose-600" : "text-on-surface"
                }`}
              >
                {staffLabel}
              </p>
            </div>

            {bundled ? (
              <div className="rounded-xl border border-teal-200/80 bg-teal-50/70 px-3 py-2.5">
                <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-teal-800">
                  Bundled SMS
                </p>
                <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">
                  {bundled.name}
                </p>
                <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                  {subscription.smsRemaining === null
                    ? "Unlimited remaining"
                    : `${subscription.smsRemaining} of ${subscription.smsLimit} remaining`}
                  {smsRenewDate
                    ? ` · renews ${formatShortDate(smsRenewDate)}`
                    : ""}
                </p>
                <p className="mt-1 font-body text-[11px] text-teal-800/85">
                  {formatMessageQuotaLabel(bundled.messageQuota)} included each
                  billing period · {SMS_BUNDLE_RENEWS_NOTE.toLowerCase()}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {stripeEnabled && isStripeCheckoutEnabled() ? (
          <button
            type="button"
            onClick={onManagePayment}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-outline-variant bg-white px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[18px]">credit_card</span>
            Manage payment
          </button>
        ) : null}
      </div>

      <div className="border-t border-outline-variant/60 bg-surface-container-lowest px-5 py-4 sm:px-6">
        <div className="h-2 overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-body text-[11px] text-on-surface-variant">
          <span>Period started</span>
          <span className="font-semibold text-on-surface">
            {daysLeft} day{daysLeft === 1 ? "" : "s"} until renewal
          </span>
          <span>Renews</span>
        </div>
      </div>
    </section>
  );
}

function planCardTheme(color: string) {
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

function formatStaffShort(staff: number): string {
  if (staff < 0) return "∞";
  return String(staff);
}

function PlanChangeCard({
  plan,
  isCurrent,
  changing,
  onChange,
}: {
  plan: AvailablePlanOption;
  isCurrent: boolean;
  changing: boolean;
  onChange: () => void;
}) {
  const theme = planCardTheme(plan.color);
  const sms = plan.bundledSmsPackage;
  const directionLabel =
    plan.direction === "upgrade"
      ? "Upgrade"
      : plan.direction === "downgrade"
        ? "Downgrade"
        : "Select plan";

  const featureItems: string[] = [];
  if (sms) {
    featureItems.push(
      `${formatMessageQuotaLabel(sms.messageQuota)} included (${sms.name})`,
    );
  }
  featureItems.push(
    formatRenewalLabel(plan.billingCycle, plan.validityDays),
    ...plan.features,
  );
  const featurePreview = featureItems.slice(0, 3);

  return (
    <article className="group relative flex h-full flex-col">
      <div
        className={`absolute -inset-px rounded-[1.35rem] bg-gradient-to-br opacity-40 blur-sm transition-opacity duration-300 group-hover:opacity-70 ${theme.gradient} ${
          isCurrent ? "opacity-70" : ""
        }`}
        aria-hidden
      />
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] ${
          isCurrent
            ? "border-primary/40 ring-2 ring-primary/20"
            : "border-white/60"
        }`}
      >
        <div
          className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl ${theme.glow}`}
          aria-hidden
        />

        <div className="relative flex flex-1 flex-col px-5 pb-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${theme.icon}`}
              >
                <span className="material-symbols-outlined text-[24px]">
                  {plan.icon || "inventory_2"}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="truncate font-display text-[16px] font-bold tracking-tight text-on-surface">
                  {plan.name}
                </h3>
                <p className="mt-0.5 font-mono text-[11px] text-on-surface-variant">
                  {plan.plan_key || plan.billingCycle.toUpperCase()}
                </p>
              </div>
            </div>
            {isCurrent ? (
              <span className="shrink-0 rounded-full bg-[#1a1d24] px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wide text-white">
                Current
              </span>
            ) : plan.popular ? (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${theme.chip}`}
              >
                Popular
              </span>
            ) : null}
          </div>

          <div className="mt-5">
            <p className="font-body text-[11px] font-medium uppercase tracking-[0.12em] text-on-surface-variant">
              Staff
            </p>
            <p className="mt-1 font-display text-[42px] font-bold leading-none tracking-tight text-on-surface">
              {formatStaffShort(plan.staff)}
            </p>
            <p className="mt-1 font-body text-[12px] text-on-surface-variant">
              {formatLimitLabel(plan.staff, "staff member", "staff members")}
            </p>
            {plan.description ? (
              <p className="mt-2 line-clamp-2 font-body text-[12px] leading-snug text-on-surface-variant">
                {plan.description}
              </p>
            ) : null}
          </div>

          {featurePreview.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-dashed border-outline-variant/70 pt-4">
              {featurePreview.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r ${theme.gradient}`}
                  />
                  <span className="line-clamp-2">{feature}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {!plan.changeAllowed && plan.blockReason && !isCurrent ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[11px] leading-snug text-amber-900">
              {plan.blockReason}
            </p>
          ) : null}

          {isCurrent ? (
            <span className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-primary/10 px-4 py-3 font-body text-[13px] font-semibold text-primary">
              Current plan
            </span>
          ) : (
            <button
              type="button"
              disabled={changing || !plan.changeAllowed}
              onClick={onChange}
              className="mt-4 inline-flex w-full items-center justify-between gap-3 rounded-xl bg-[#1a1d24] px-4 py-3 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[#2a2f3a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {changing ? (
                <span className="inline-flex w-full items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Processing…
                </span>
              ) : (
                <>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="material-symbols-outlined shrink-0 text-[18px]">
                      {plan.direction === "downgrade"
                        ? "arrow_downward"
                        : "arrow_upward"}
                    </span>
                    <span className="truncate">{directionLabel}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums">
                    {plan.priceLabel}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function OwnerSubscriptionBoard() {
  const { user } = useAuth();
  const { refresh: refreshSubscriptionAccess } = useTenantSubscription();
  const [subscription, setSubscription] =
    useState<TenantSubscriptionSnapshot | null>(null);
  const [plans, setPlans] = useState<AvailablePlanOption[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<AvailablePlanOption | null>(
    null,
  );
  const [addingPayment, setAddingPayment] = useState(false);
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/business/subscription", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        subscription?: TenantSubscriptionSnapshot;
        plans?: AvailablePlanOption[];
        stripeEnabled?: boolean;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok || !data.subscription) {
        setError(data.error ?? "Could not load subscription.");
        return;
      }
      setSubscription(data.subscription);
      setPlans(data.plans ?? []);
      setStripeEnabled(Boolean(data.stripeEnabled));
    } catch {
      setError("Could not load subscription.");
    } finally {
      setLoading(false);
      hasLoadedRef.current = true;
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useStripeCheckoutReturn({
    onSuccess: () => {
      setNotice("Subscription renewed successfully. Welcome back!");
      void load();
      void refreshSubscriptionAccess();
    },
    onCanceled: () => {
      setNotice("Checkout was canceled. Your plan was not changed.");
    },
    onError: (message) => setError(message),
  });

  async function startSubscriptionCheckout(planId: string) {
    if (!user) return false;
    const token = await user.getIdToken();
    const res = await fetch("/api/stripe/checkout/subscription", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        planId,
        successPath: "/dashboard/subscription?checkout=success",
        cancelPath: "/dashboard/subscription?checkout=canceled",
      }),
    });
    const data = await readJsonResponse<{
      ok?: boolean;
      url?: string;
      error?: string;
    }>(res);
    if (!res.ok || !data.ok || !data.url) {
      setError(data.error ?? "Could not start checkout.");
      return false;
    }
    window.location.href = data.url;
    return true;
  }

  async function handleAddPaymentDetails() {
    if (!subscription?.planId) {
      setError("No subscription plan is assigned to your account.");
      return;
    }
    setAddingPayment(true);
    setError(null);
    try {
      await startSubscriptionCheckout(subscription.planId);
    } catch {
      setError("Could not start payment setup.");
    } finally {
      setAddingPayment(false);
    }
  }

  async function executePlanChange(
    plan: AvailablePlanOption,
  ): Promise<"redirect" | "complete" | "failed"> {
    if (!user || plan.direction === "same" || !plan.changeAllowed) {
      return "failed";
    }

    if (plan.direction === "downgrade" && plan.blockReason) {
      setError(plan.blockReason);
      return "failed";
    }

    setChangingId(plan.id);
    setCheckoutRedirecting(false);
    setError(null);
    setNotice(null);
    let redirecting = false;

    try {
      const token = await user.getIdToken();
      const useStripe = stripeEnabled && isStripeCheckoutEnabled();

      if (useStripe) {
        const started = await startSubscriptionCheckout(plan.id);
        if (started) {
          redirecting = true;
          setCheckoutRedirecting(true);
          return "redirect";
        }
        return "failed";
      }

      const res = await fetch("/api/business/subscription", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not change plan.");
        return "failed";
      }
      setNotice(
        `Your plan has been changed to ${plan.name}. You can upgrade or downgrade again anytime.`,
      );
      await load();
      await refreshSubscriptionAccess();
      return "complete";
    } catch {
      setError("Could not change subscription plan.");
      return "failed";
    } finally {
      if (!redirecting) {
        setChangingId(null);
        setCheckoutRedirecting(false);
      }
    }
  }

  function requestPlanChange(plan: AvailablePlanOption) {
    if (!user || plan.direction === "same" || !plan.changeAllowed) return;
    if (plan.direction === "downgrade" && plan.blockReason) {
      setError(plan.blockReason);
      return;
    }
    setConfirmPlan(plan);
  }

  async function openBillingPortal() {
    if (!user) return;
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse<{ ok?: boolean; url?: string; error?: string }>(
        res,
      );
      if (!res.ok || !data.ok || !data.url) {
        setError(data.error ?? "Could not open billing portal.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not open billing portal.");
    }
  }

  if (loading && !subscription) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading subscription…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 font-body text-[12px] font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {subscription ? (
        <SubscriptionRenewalBanner
          subscription={subscription}
          stripeEnabled={stripeEnabled && isStripeCheckoutEnabled()}
          addingPayment={addingPayment}
          onAddPayment={() => void handleAddPaymentDetails()}
          onManagePayment={() => void openBillingPortal()}
        />
      ) : null}

      {subscription &&
      subscription.staffLimit >= 0 &&
      subscription.staffCount > subscription.staffLimit ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] text-rose-800">
          You have more staff than your plan allows. Remove team members in{" "}
          <Link
            href="/dashboard/team/management"
            className="font-semibold text-primary underline"
          >
            Team management
          </Link>{" "}
          before downgrading.
        </p>
      ) : null}

      <section className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <p className="font-body text-[13px] leading-relaxed text-sky-950">
          You can <strong>upgrade</strong> or <strong>downgrade</strong> your
          subscription anytime. When downgrading, your staff count must fit the
          new plan limit — remove team members in{" "}
          <Link
            href="/dashboard/team/management"
            className="font-semibold text-primary underline"
          >
            Team management
          </Link>{" "}
          first if needed.
        </p>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">
            sell
          </span>
          <div>
            <h2 className="font-display text-[16px] font-semibold text-on-surface">
              Available Plans
            </h2>
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              Choose the best plan for your workshop
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <PlanChangeCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === subscription?.planId}
              changing={changingId === plan.id}
              onChange={() => requestPlanChange(plan)}
            />
          ))}
        </div>
        {plans.length === 0 && !loading ? (
          <p className="font-body text-[13px] text-on-surface-variant">
            No subscription plans are available right now.
          </p>
        ) : null}
      </section>

      <CheckoutConfirmModal
        open={confirmPlan !== null}
        title={
          confirmPlan?.direction === "downgrade"
            ? "Confirm downgrade"
            : confirmPlan?.direction === "upgrade"
              ? "Confirm upgrade"
              : "Confirm plan change"
        }
        description={
          confirmPlan
            ? (() => {
                const stripeNote =
                  stripeEnabled && isStripeCheckoutEnabled()
                    ? " You will be redirected to Stripe to complete payment."
                    : "";
                const smsNote = confirmPlan.bundledSmsPackage
                  ? ` Includes ${formatMessageQuotaLabel(
                      confirmPlan.bundledSmsPackage.messageQuota,
                    )} SMS (${confirmPlan.bundledSmsPackage.name}).`
                  : "";
                if (confirmPlan.direction === "downgrade") {
                  return `Switch to ${confirmPlan.name} for ${confirmPlan.priceLabel}? Staff and SMS limits will follow the new plan.${smsNote}${stripeNote}`;
                }
                return `Switch to ${confirmPlan.name} for ${confirmPlan.priceLabel}?${smsNote}${stripeNote}`;
              })()
            : ""
        }
        confirmLabel={
          confirmPlan?.direction === "downgrade"
            ? "Confirm downgrade"
            : confirmPlan?.direction === "upgrade"
              ? "Confirm upgrade"
              : "Confirm change"
        }
        icon={
          confirmPlan?.direction === "downgrade"
            ? "arrow_downward"
            : confirmPlan?.direction === "upgrade"
              ? "arrow_upward"
              : "workspace_premium"
        }
        tone={confirmPlan?.direction === "downgrade" ? "warning" : "primary"}
        isLoading={changingId !== null}
        loadingLabel={
          checkoutRedirecting ? "Redirecting to Stripe…" : "Processing…"
        }
        onCancel={() => {
          if (changingId) return;
          setConfirmPlan(null);
        }}
        onConfirm={() => {
          if (!confirmPlan) return;
          void executePlanChange(confirmPlan).then((result) => {
            if (result !== "redirect") setConfirmPlan(null);
          });
        }}
      />
    </div>
  );
}
