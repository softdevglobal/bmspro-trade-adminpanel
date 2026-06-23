"use client";

import { CheckoutConfirmModal } from "@/components/checkout-confirm-modal";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import {
  formatMessageQuotaLabel,
  formatSmsPriceLabel,
} from "@/lib/sms-packages/helpers";
import {
  SMS_LOW_BALANCE_THRESHOLD,
  type BusinessSmsBalance,
} from "@/lib/sms-packages/balance";
import { useSmsBalance } from "@/lib/sms/sms-balance-context";
import type { SmsPackage } from "@/lib/sms-packages/types";
import type { PlanThemeId } from "@/lib/subscription-plans/theme";
import { isStripeCheckoutEnabled } from "@/lib/stripe/public";
import { useStripeCheckoutReturn } from "@/lib/stripe/use-stripe-checkout-return";
import { useCallback, useEffect, useRef, useState } from "react";

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

function BalanceHero({ balance }: { balance: BusinessSmsBalance }) {
  const remainingLabel = balance.isUnlimited
    ? "Unlimited"
    : String(balance.remaining ?? 0);

  return (
    <section
      className={`rounded-2xl border p-5 sm:p-6 ${
        balance.isLow
          ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white"
          : "border-outline-variant bg-surface"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-on-surface-variant">
            SMS remaining
          </p>
          <p className="mt-1 font-display text-[40px] font-bold leading-none text-on-surface">
            {remainingLabel}
          </p>
          {!balance.isUnlimited ? (
            <p className="mt-2 font-body text-[13px] text-on-surface-variant">
              {balance.used} used of {balance.limit} total
            </p>
          ) : (
            <p className="mt-2 font-body text-[13px] text-on-surface-variant">
              {balance.used} messages sent
            </p>
          )}
          {balance.smsPackageName ? (
            <p className="mt-1 font-body text-[12px] text-on-surface-variant">
              Current plan: {balance.smsPackageName}
            </p>
          ) : null}
        </div>
        {balance.isLow ? (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-white px-4 py-3 shadow-sm">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
            <div>
              <p className="font-body text-[13px] font-semibold text-rose-800">
                Low SMS balance
              </p>
              <p className="mt-0.5 font-body text-[12px] text-rose-700">
                You have fewer than {SMS_LOW_BALANCE_THRESHOLD} SMS left. Top up
                below to keep sending customer notifications.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SmsTopUpCard({
  pkg,
  purchasing,
  onPurchase,
}: {
  pkg: SmsPackage;
  purchasing: boolean;
  onPurchase: () => void;
}) {
  const theme = themeStyles(pkg.color);
  const priceLabel = pkg.priceLabel || formatSmsPriceLabel(pkg.price);

  return (
    <article className="group relative flex h-full flex-col">
      <div
        className={`absolute -inset-px rounded-[1.35rem] bg-gradient-to-br opacity-40 blur-sm transition-opacity duration-300 group-hover:opacity-70 ${theme.gradient}`}
        aria-hidden
      />
      <div className="relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/60 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)]">
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
            {pkg.popular ? (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${theme.chip}`}
              >
                Popular
              </span>
            ) : null}
          </div>

          <div className="mt-5">
            <p className="font-body text-[11px] font-medium uppercase tracking-[0.12em] text-on-surface-variant">
              Messages
            </p>
            <p className="mt-1 font-display text-[42px] font-bold leading-none tracking-tight text-on-surface">
              {formatQuotaShort(pkg.messageQuota)}
            </p>
            {pkg.description ? (
              <p className="mt-2 line-clamp-2 font-body text-[12px] leading-snug text-on-surface-variant">
                {pkg.description}
              </p>
            ) : null}
          </div>

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

          <button
            type="button"
            disabled={purchasing}
            onClick={onPurchase}
            className="mt-4 inline-flex w-full items-center justify-between gap-3 rounded-xl bg-[#1a1d24] px-4 py-3 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[#2a2f3a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {purchasing ? (
              <span className="inline-flex w-full items-center justify-center gap-1.5">
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Topping up…
              </span>
            ) : (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="material-symbols-outlined shrink-0 text-[18px]">
                    {isStripeCheckoutEnabled() ? "payments" : "add_circle"}
                  </span>
                  <span className="truncate">Top up package</span>
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums">
                  {priceLabel}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export function OwnerSmsBoard() {
  const { user } = useAuth();
  const { balance: cachedBalance, refresh } = useSmsBalance();
  const [balance, setBalance] = useState<BusinessSmsBalance | null>(
    cachedBalance,
  );
  const [packages, setPackages] = useState<SmsPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [confirmPackage, setConfirmPackage] = useState<SmsPackage | null>(null);
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  const pendingCheckoutRef = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("checkout") ===
        "success" &&
      Boolean(new URLSearchParams(window.location.search).get("session_id")),
  );
  const [confirmingCheckout, setConfirmingCheckout] = useState(
    () => pendingCheckoutRef.current,
  );

  const load = useCallback(async () => {
    if (!user) return null;
    const seq = ++loadSeqRef.current;
    setError(null);
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/business/sms", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        balance?: BusinessSmsBalance;
        packages?: SmsPackage[];
        error?: string;
      }>(res);
      if (seq !== loadSeqRef.current) return null;
      if (!res.ok || !data.ok || !data.balance) {
        setError(data.error ?? "Could not load SMS details.");
        return null;
      }
      setBalance(data.balance);
      setPackages(data.packages ?? []);
      return data.balance;
    } catch {
      if (seq === loadSeqRef.current) {
        setError("Could not load SMS details.");
      }
      return null;
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        hasLoadedRef.current = true;
      }
    }
  }, [user]);

  useEffect(() => {
    if (pendingCheckoutRef.current) return;
    void load();
  }, [load]);

  useEffect(() => {
    if (!cachedBalance || pendingCheckoutRef.current) return;
    setBalance(cachedBalance);
  }, [cachedBalance]);

  useStripeCheckoutReturn({
    onSuccess: async (result) => {
      pendingCheckoutRef.current = false;
      setConfirmingCheckout(false);
      if (result.balance) {
        setBalance(result.balance);
      }
      await load();
      await refresh();
      setSuccessMessage(
        result.alreadyFulfilled
          ? "This top-up was already applied to your account."
          : "Payment confirmed. Your SMS balance has been updated.",
      );
    },
    onCanceled: () => {
      pendingCheckoutRef.current = false;
      setConfirmingCheckout(false);
      setError("Checkout was canceled. No charges were made.");
      void load();
    },
    onError: (message) => {
      pendingCheckoutRef.current = false;
      setConfirmingCheckout(false);
      setError(message);
      void load();
    },
  });

  async function handlePurchase(
    pkg: SmsPackage,
  ): Promise<"redirect" | "complete" | "failed"> {
    if (!user) return "failed";

    setPurchasingId(pkg.id);
    setCheckoutRedirecting(false);
    setError(null);
    setSuccessMessage(null);
    let redirecting = false;
    try {
      const token = await user.getIdToken();

      if (isStripeCheckoutEnabled()) {
        const res = await fetch("/api/stripe/checkout/sms", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ packageId: pkg.id }),
        });
        const data = await readJsonResponse<{
          ok?: boolean;
          url?: string;
          error?: string;
        }>(res);
        if (!res.ok || !data.ok || !data.url) {
          setError(data.error ?? "Could not start checkout.");
          return "failed";
        }
        setCheckoutRedirecting(true);
        redirecting = true;
        window.location.href = data.url;
        return "redirect";
      }

      const res = await fetch("/api/business/sms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        balance?: BusinessSmsBalance;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok || !data.balance) {
        setError(data.error ?? "Could not top up SMS credits.");
        return "failed";
      }
      setBalance(data.balance);
      setSuccessMessage(
        `${pkg.name} top-up complete. You now have ${
          data.balance.isUnlimited
            ? "unlimited"
            : String(data.balance.remaining ?? 0)
        } SMS remaining.`,
      );
      await refresh();
      return "complete";
    } catch {
      setError("Could not top up SMS credits.");
      return "failed";
    } finally {
      if (!redirecting) {
        setPurchasingId(null);
        setCheckoutRedirecting(false);
      }
    }
  }

  if (confirmingCheckout) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Confirming your payment…
        </p>
      </div>
    );
  }

  if (loading && !balance) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading SMS packages…
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
      {successMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 font-body text-[12px] font-semibold text-emerald-800">
          {successMessage}
        </p>
      ) : null}

      {balance ? <BalanceHero balance={balance} /> : null}

      <section>
        <div className="mb-4">
          <h2 className="font-display text-[16px] font-semibold text-on-surface">
            Top up SMS
          </h2>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Add more messages to your balance. Top-ups stay on your account
            across subscription renewals.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {packages.map((pkg) => (
            <SmsTopUpCard
              key={pkg.id}
              pkg={pkg}
              purchasing={purchasingId === pkg.id}
              onPurchase={() => setConfirmPackage(pkg)}
            />
          ))}
        </div>
        {packages.length === 0 && !loading ? (
          <p className="font-body text-[13px] text-on-surface-variant">
            No SMS packages are available right now.
          </p>
        ) : null}
      </section>

      <CheckoutConfirmModal
        open={confirmPackage !== null}
        title="Confirm SMS top-up"
        description={
          confirmPackage
            ? `Purchase ${confirmPackage.name} for ${
                confirmPackage.priceLabel ||
                formatSmsPriceLabel(confirmPackage.price)
              }? This adds ${formatMessageQuotaLabel(
                confirmPackage.messageQuota,
              )} to your SMS balance.${
                isStripeCheckoutEnabled()
                  ? " You will be redirected to Stripe to complete payment."
                  : ""
              }`
            : ""
        }
        confirmLabel="Top up now"
        icon="sms"
        isLoading={purchasingId !== null}
        loadingLabel={
          checkoutRedirecting ? "Redirecting to Stripe…" : "Processing…"
        }
        onCancel={() => {
          if (purchasingId) return;
          setConfirmPackage(null);
        }}
        onConfirm={() => {
          if (!confirmPackage) return;
          void handlePurchase(confirmPackage).then((result) => {
            if (result !== "redirect") setConfirmPackage(null);
          });
        }}
      />
    </div>
  );
}
