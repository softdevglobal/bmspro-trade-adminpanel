"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useState } from "react";

type FeePayerMode = "business" | "customer";
type BankTransferDetails = {
  bankName: string;
  businessName: string;
  bsb: string;
  accountNumber: string;
};

type PaymentsProfile = {
  feePayerMode: FeePayerMode;
  stripeConnectAccountId: string | null;
  stripeConnectOnboarded: boolean;
  bankTransferDetails: BankTransferDetails | null;
};

const EMPTY_BANK_DETAILS: BankTransferDetails = {
  bankName: "",
  businessName: "",
  bsb: "",
  accountNumber: "",
};

function maskAccountId(accountId: string): string {
  if (accountId.length <= 10) return accountId;
  return `${accountId.slice(0, 8)}…${accountId.slice(-4)}`;
}

export function BusinessPaymentsSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PaymentsProfile | null>(null);
  const [feeMode, setFeeMode] = useState<FeePayerMode>("business");
  const [connecting, setConnecting] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [bankDetails, setBankDetails] = useState<BankTransferDetails>(EMPTY_BANK_DETAILS);
  const [savingBankDetails, setSavingBankDetails] = useState(false);
  const [bankNotice, setBankNotice] = useState<string | null>(null);
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
        const resolvedMode =
          payload.profile.feePayerMode === "customer" ? "customer" : "business";
        setProfile({
          feePayerMode: resolvedMode,
          stripeConnectAccountId: payload.profile.stripeConnectAccountId ?? null,
          stripeConnectOnboarded:
            payload.profile.stripeConnectOnboarded === true,
          bankTransferDetails: payload.profile.bankTransferDetails ?? null,
        });
        setBankDetails({
          ...EMPTY_BANK_DETAILS,
          ...(payload.profile.bankTransferDetails ?? {}),
        });
        setFeeMode(resolvedMode);
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

  async function handleSaveFeeMode() {
    if (!user || !profile) return;
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
        body: JSON.stringify({ feePayerMode: feeMode }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save fee setting.");
      }
      setProfile({ ...profile, feePayerMode: feeMode });
      setNotice("Fee setting saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save fee setting.",
      );
    } finally {
      setSavingMode(false);
    }
  }

  async function handleSaveBankDetails() {
    if (!user) return;
    setSavingBankDetails(true);
    setBankNotice(null);
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
        body: JSON.stringify({ bankTransferDetails: bankDetails }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        profile?: { bankTransferDetails?: BankTransferDetails | null };
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save bank transfer details.");
      }
      const saved = payload.profile?.bankTransferDetails ?? null;
      setProfile((current) => current ? { ...current, bankTransferDetails: saved } : current);
      setBankDetails({ ...EMPTY_BANK_DETAILS, ...(saved ?? {}) });
      setBankNotice(saved ? "Bank details saved." : "Bank details cleared.");
    } catch (err) {
      setBankNotice(null);
      setError(err instanceof Error ? err.message : "Could not save bank transfer details.");
    } finally {
      setSavingBankDetails(false);
    }
  }

  const connected = Boolean(profile?.stripeConnectAccountId);
  const onboarded = Boolean(profile?.stripeConnectOnboarded);

  return (
    <SettingsSection
      icon="payments"
      title="Payments"
      description="Manage Stripe card payments and the bank transfer details shown on quotations and invoices."
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

          {/* Bank transfer instructions */}
          <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/40 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined mt-0.5 text-[21px] text-primary">account_balance</span>
              <div>
                <p className="font-body text-[14px] font-semibold text-on-surface">Bank transfer</p>
                <p className="mt-1 max-w-2xl font-body text-[12px] leading-relaxed text-on-surface-variant">
                  Add a bank transfer option for customers. These details appear on quotations and invoices when all four fields are saved.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BankField label="Bank name" value={bankDetails.bankName} onChange={(value) => setBankDetails((current) => ({ ...current, bankName: value }))} placeholder="e.g. Commonwealth Bank" />
              <BankField label="Business name" value={bankDetails.businessName} onChange={(value) => setBankDetails((current) => ({ ...current, businessName: value }))} placeholder="Account name" />
              <BankField label="BSB" value={bankDetails.bsb} onChange={(value) => setBankDetails((current) => ({ ...current, bsb: value }))} placeholder="000-000" />
              <BankField label="Account number" value={bankDetails.accountNumber} onChange={(value) => setBankDetails((current) => ({ ...current, accountNumber: value }))} placeholder="Account number" />
            </div>
            <div className="mt-4 flex justify-end border-t border-outline-variant/50 pt-4">
              <button
                type="button"
                disabled={savingBankDetails}
                onClick={() => void handleSaveBankDetails()}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {savingBankDetails ? "Saving…" : "Save bank details"}
              </button>
            </div>
            {bankNotice ? (
              <p role="status" className="mt-3 font-body text-[12px] font-semibold text-primary">
                {bankNotice}
              </p>
            ) : null}
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
                active={feeMode === "business"}
                disabled={savingMode}
                onSelect={() => setFeeMode("business")}
                icon="account_balance_wallet"
                title="Business absorbs the fee"
                description="The customer pays exactly the amount. Stripe's fee is deducted from your payout."
              />
              <FeeOption
                active={feeMode === "customer"}
                disabled={savingMode}
                onSelect={() => setFeeMode("customer")}
                icon="add_card"
                title="Customer pays the fee"
                description="A processing fee (approx. 2.9% + $0.30) is added at checkout so you receive the full amount."
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                disabled={savingMode || !profile || feeMode === profile.feePayerMode}
                onClick={() => void handleSaveFeeMode()}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {savingMode ? "Saving…" : "Save fee setting"}
              </button>
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

function BankField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block font-body text-[12px] font-semibold text-on-surface">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={label === "Account number" ? 30 : label === "Business name" ? 120 : label === "BSB" ? 12 : 100}
        autoComplete="off"
        placeholder={placeholder}
        className="mt-1.5 h-11 w-full rounded-xl border border-outline-variant bg-surface px-3 font-body text-[13px] font-normal text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
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
