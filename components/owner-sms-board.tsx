"use client";

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
import {
  planThemeGradient,
  planThemeSurface,
} from "@/lib/subscription-plans/theme";
import { useCallback, useEffect, useState } from "react";

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
                You have fewer than {SMS_LOW_BALANCE_THRESHOLD} SMS left. Top up below to keep sending
                customer notifications.
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
  const gradient = planThemeGradient(pkg.color);

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
      <div className={`relative bg-gradient-to-br ${gradient} px-5 py-6 text-white`}>
        {pkg.popular ? (
          <span className="absolute right-4 top-4 rounded-full bg-white/25 px-2.5 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide">
            Most Popular
          </span>
        ) : null}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 shadow-inner">
          <span className="material-symbols-outlined text-[28px]">
            {pkg.icon || "sms"}
          </span>
        </div>
        <h3 className="mt-5 font-display text-[18px] font-bold leading-tight">
          {pkg.name}
        </h3>
        <p className="mt-2 font-display text-[26px] font-bold tracking-tight">
          {pkg.priceLabel || formatSmsPriceLabel(pkg.price)}
        </p>
        <p className="mt-4 font-body text-[12px] text-white/90">
          +{formatMessageQuotaLabel(pkg.messageQuota)}
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
            {pkg.features.slice(0, 3).map((feature) => (
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
        <button
          type="button"
          disabled={purchasing}
          onClick={onPurchase}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a1d24] px-4 py-2.5 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[#2a2f3a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {purchasing ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[18px]">
                progress_activity
              </span>
              Processing…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
              Buy package
            </>
          )}
        </button>
      </div>
    </article>
  );
}

export function OwnerSmsBoard() {
  const { user } = useAuth();
  const { balance: cachedBalance, refresh } = useSmsBalance();
  const [balance, setBalance] = useState<BusinessSmsBalance | null>(cachedBalance);
  const [packages, setPackages] = useState<SmsPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
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
      if (!res.ok || !data.ok || !data.balance) {
        setError(data.error ?? "Could not load SMS details.");
        return;
      }
      setBalance(data.balance);
      setPackages(data.packages ?? []);
    } catch {
      setError("Could not load SMS details.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cachedBalance) setBalance(cachedBalance);
  }, [cachedBalance]);

  async function handlePurchase(pkg: SmsPackage) {
    if (!user) return;
    const confirmed = window.confirm(
      `Buy ${pkg.name} and add ${formatMessageQuotaLabel(pkg.messageQuota)} to your account for ${pkg.priceLabel || formatSmsPriceLabel(pkg.price)}?`,
    );
    if (!confirmed) return;

    setPurchasingId(pkg.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const token = await user.getIdToken();
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
        setError(data.error ?? "Could not purchase SMS package.");
        return;
      }
      setBalance(data.balance);
      setSuccessMessage(
        `${pkg.name} purchased. You now have ${
          data.balance.isUnlimited
            ? "unlimited"
            : String(data.balance.remaining ?? 0)
        } SMS remaining.`,
      );
      await refresh();
    } catch {
      setError("Could not purchase SMS package.");
    } finally {
      setPurchasingId(null);
    }
  }

  if (loading && !balance) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
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
          <h2 className="font-display text-[18px] font-semibold text-on-surface">
            Buy SMS packages
          </h2>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            Top up your SMS credits. Purchased messages are added to your
            remaining balance.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {packages.map((pkg) => (
            <SmsTopUpCard
              key={pkg.id}
              pkg={pkg}
              purchasing={purchasingId === pkg.id}
              onPurchase={() => void handlePurchase(pkg)}
            />
          ))}
        </div>
        {packages.length === 0 && !loading ? (
          <p className="font-body text-[13px] text-on-surface-variant">
            No SMS packages are available right now.
          </p>
        ) : null}
      </section>
    </div>
  );
}
