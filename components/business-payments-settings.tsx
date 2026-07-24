"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useState } from "react";

type FeePayerMode = "business" | "customer";

type PaymentsProfile = {
  feePayerMode: FeePayerMode;
  stripeConnectAccountId: string | null;
  stripeConnectOnboarded: boolean;
};

function maskAccountId(accountId: string): string {
  if (accountId.length <= 10) return accountId;
  return `${accountId.slice(0, 8)}…${accountId.slice(-4)}`;
}

export function BusinessPaymentsSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PaymentsProfile | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Surface the OAuth callback result once, then tidy the URL. Handled inside
    // an async task so it doesn't fire setState synchronously in the effect body.
    async function readFlash() {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const stripe = params.get("stripe");
      if (!stripe || !active) return;
      if (stripe === "connected") {
        setNotice("Stripe account connected.");
      } else if (stripe === "error") {
        setError("Stripe connection was cancelled or failed. Please try again.");
      }
      params.delete("stripe");
      const next = `${window.location.pathname}${
        params.toString() ? `?${params}` : ""
      }`;
      window.history.replaceState(null, "", next);
    }

    async function load() {
      await readFlash();
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/business/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          profile?: PaymentsProfile;
        };
        if (!response.ok || !payload.ok || !payload.profile || !active) return;
        setProfile({
          feePayerMode:
            payload.profile.feePayerMode === "customer"
              ? "customer"
              : "business",
          stripeConnectAccountId: payload.profile.stripeConnectAccountId ?? null,
          stripeConnectOnboarded:
            payload.profile.stripeConnectOnboarded === true,
        });
      } catch {
        /* keep defaults */
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    // If the browser restores this page from bfcache (e.g. the user hits Back
    // from Stripe before finishing), the button is still frozen mid-redirect
    // from before we navigated away. Reset it so it's clickable again.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setConnecting(false);
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function handleConnect() {
    if (!user) return;
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/stripe/connect", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not start Stripe connection.");
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start Stripe connection.",
      );
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!user) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Disconnect Stripe? Customers won't be able to pay online.")
    ) {
      return;
    }
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/stripe/connect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not disconnect Stripe.");
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              stripeConnectAccountId: null,
              stripeConnectOnboarded: false,
            }
          : current,
      );
      setNotice("Stripe account disconnected.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not disconnect Stripe.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleFeeModeChange(mode: FeePayerMode) {
    if (!user || !profile || profile.feePayerMode === mode) return;
    const previous = profile.feePayerMode;
    setProfile({ ...profile, feePayerMode: mode });
    setSavingMode(true);
    setError(null);
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ feePayerMode: mode }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save fee setting.");
      }
      setNotice("Fee setting saved.");
    } catch (err) {
      setProfile((current) =>
        current ? { ...current, feePayerMode: previous } : current,
      );
      setError(
        err instanceof Error ? err.message : "Could not save fee setting.",
      );
    } finally {
      setSavingMode(false);
    }
  }

  const connected = Boolean(profile?.stripeConnectAccountId);
  const onboarded = Boolean(profile?.stripeConnectOnboarded);

  return (
    <SettingsSection
      icon="payments"
      title="Online payments (Stripe)"
      description="Accept card payments for quotation deposits and invoices. Funds go directly to your connected Stripe account."
    >
      {loading ? (
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading payment settings…
        </p>
      ) : (
        <div className="space-y-5">
          {/* Connection status */}
          <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/70 px-4 py-3.5">
            {connected ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined mt-0.5 text-[20px] ${
                      onboarded ? "text-primary" : "text-amber-500"
                    }`}
                  >
                    {onboarded ? "verified" : "pending"}
                  </span>
                  <div>
                    <p className="font-body text-[13px] font-semibold text-on-surface">
                      {onboarded
                        ? "Stripe connected & active"
                        : "Stripe connected — finish setup"}
                    </p>
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      {onboarded
                        ? "Ready to accept card payments."
                        : "Your Stripe account can't accept charges yet. Complete verification in your Stripe dashboard."}
                    </p>
                    {profile?.stripeConnectAccountId ? (
                      <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
                        {maskAccountId(profile.stripeConnectAccountId)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => void handleDisconnect()}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-on-surface-variant">
                    account_balance
                  </span>
                  <div>
                    <p className="font-body text-[13px] font-semibold text-on-surface">
                      Connect your Stripe account
                    </p>
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      One click to link an existing Stripe account and start
                      taking payments.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => void handleConnect()}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#635bff] px-4 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[#5850ec] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {connecting ? "Redirecting…" : "Connect with Stripe"}
                </button>
              </div>
            )}
          </div>

          {/* Fee payer */}
          <div>
            <p className="font-body text-[13px] font-semibold text-on-surface">
              Who pays the card processing fee?
            </p>
            <p className="mt-1 font-body text-[12px] text-on-surface-variant">
              Applies to both quotation deposits and invoice payments.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FeeOption
                active={profile?.feePayerMode === "business"}
                disabled={savingMode}
                onSelect={() => void handleFeeModeChange("business")}
                icon="account_balance_wallet"
                title="Business absorbs the fee"
                description="The customer pays exactly the amount. Stripe's fee is deducted from your payout."
              />
              <FeeOption
                active={profile?.feePayerMode === "customer"}
                disabled={savingMode}
                onSelect={() => void handleFeeModeChange("customer")}
                icon="add_card"
                title="Customer pays the fee"
                description="A processing fee (approx. 2.9% + $0.30) is added at checkout so you receive the full amount."
              />
            </div>
          </div>

          {error ? (
            <p className="font-body text-[12px] font-semibold text-error">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="font-body text-[12px] font-semibold text-primary">
              {notice}
            </p>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}

function FeeOption({
  active,
  disabled,
  onSelect,
  icon,
  title,
  description,
}: {
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={active}
      className={`flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-outline-variant/70 bg-surface-container-low/60 hover:border-outline-variant"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`material-symbols-outlined text-[18px] ${
            active ? "text-primary" : "text-on-surface-variant"
          }`}
        >
          {icon}
        </span>
        <span className="font-body text-[13px] font-semibold text-on-surface">
          {title}
        </span>
        {active ? (
          <span className="material-symbols-outlined ml-auto text-[18px] text-primary">
            check_circle
          </span>
        ) : null}
      </div>
      <p className="font-body text-[12px] leading-relaxed text-on-surface-variant">
        {description}
      </p>
    </button>
  );
}
