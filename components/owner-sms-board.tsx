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
    <article className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className={`bg-gradient-to-br ${gradient} px-3 py-3 text-white`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20">
              <span className="material-symbols-outlined text-[20px]">
                {pkg.icon || "sms"}
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-display text-[14px] font-bold leading-tight">
                {pkg.name}
              </h3>
              <p className="mt-0.5 font-body text-[11px] text-white/85">
                +{formatMessageQuotaLabel(pkg.messageQuota)}
              </p>
            </div>
          </div>
          {pkg.popular ? (
            <span className="shrink-0 rounded-full bg-white/25 px-2 py-0.5 font-body text-[9px] font-bold uppercase tracking-wide">
              Popular
            </span>
          ) : null}
        </div>
        <p className="mt-2 font-display text-[20px] font-bold leading-none">
          {pkg.priceLabel || formatSmsPriceLabel(pkg.price)}
        </p>
      </div>
      <div className={`flex flex-1 flex-col ${planThemeSurface(pkg.color)} px-3 py-3`}>
        {pkg.description ? (
          <p className="line-clamp-2 font-body text-[11px] leading-snug text-on-surface-variant">
            {pkg.description}
          </p>
        ) : null}
        <button
          type="button"
          disabled={purchasing}
          onClick={onPurchase}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1a1d24] px-3 py-2 font-body text-[12px] font-semibold text-white transition-colors hover:bg-[#2a2f3a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {purchasing ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[16px]">
                progress_activity
              </span>
              Topping up…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              Top up package
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
      `Top up with ${pkg.name} and add ${formatMessageQuotaLabel(pkg.messageQuota)} for ${pkg.priceLabel || formatSmsPriceLabel(pkg.price)}?`,
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
        setError(data.error ?? "Could not top up SMS credits.");
        return;
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
    } catch {
      setError("Could not top up SMS credits.");
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
        <div className="mb-3">
          <h2 className="font-display text-[16px] font-semibold text-on-surface">
            Top up SMS
          </h2>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Add more messages to your balance. Top-ups stay on your account across
            subscription renewals.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
