"use client";

import { useState, type ReactNode } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { customerAuth } from "@/lib/firebase/customer-client";
import { buildCustomerAuthEmail } from "@/lib/customer/scoped-auth";

type Preview = { fullName: string; email: string; phone: string; businessName: string } | null;

const FIELD_LABEL = "font-body text-[13px] font-semibold tracking-wide text-on-surface-variant";
const FIELD_INPUT =
  "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low font-body text-[15px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

function Field({ label, icon, htmlFor, children }: { label: string; icon: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className={FIELD_LABEL}>{label}</label>
      <div className="relative">
        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">{icon}</span>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, placeholder, show, onToggle }: {
  id: string; value: string; onChange: (value: string) => void; placeholder: string; show: boolean; onToggle: () => void;
}) {
  return (
    <>
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        minLength={6}
        maxLength={128}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${FIELD_INPUT} pl-12 pr-11`}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary"
      >
        <span className="material-symbols-outlined text-[18px]">{show ? "visibility_off" : "visibility"}</span>
      </button>
    </>
  );
}

export function ActivationForm({ token, preview = null }: { token: string; preview?: Preview }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      // Customers go straight into the booking page already signed in. If this
      // fails for any reason they still land on the page and can sign in there.
      if (data.kind === "customer" && data.slug && data.email) {
        try {
          await signInWithEmailAndPassword(customerAuth, await buildCustomerAuthEmail(data.slug, data.email), password);
        } catch { /* fall through to the sign-in page */ }
      }
      window.location.assign(data.loginPath);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not activate your account."); setBusy(false); }
  }

  return (
    <div className="relative z-10 flex w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-[0_24px_60px_-12px_rgba(15,23,42,0.22)] sm:max-w-[480px]">
      <div className="relative shrink-0 border-b border-outline-variant bg-gradient-to-r from-primary/[0.07] via-surface-container-low to-background px-4 py-3 sm:px-5 sm:py-3.5">
        <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary shadow-md shadow-primary/25">
            <span className="material-symbols-outlined material-symbols-filled text-[20px]">storefront</span>
          </div>
          <div className="min-w-0">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Booking with</p>
            <p className="truncate font-display text-[17px] font-semibold text-on-surface">{preview?.businessName || "BMS Pro Trade"}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5 sm:pt-4">
        <header className="mb-3 text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Activate account
          </span>
          <h1 className="mt-2 font-display text-[20px] font-semibold leading-tight text-on-surface sm:text-[24px]">Set your password</h1>
          <p className="mt-0.5 font-body text-[13px] leading-snug text-on-surface-variant">
            Choose a password to verify your email and activate your account.
          </p>
        </header>

        <div className="rounded-xl border border-outline-variant bg-background p-3 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:rounded-2xl sm:p-4">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            {preview && (
              <>
                <Field label="Full name" icon="person" htmlFor="activate-name">
                  <input id="activate-name" readOnly value={preview.fullName} className={`${FIELD_INPUT} pl-12 text-on-surface-variant`} />
                </Field>
                <Field label="Mobile" icon="call" htmlFor="activate-phone">
                  <input id="activate-phone" readOnly value={preview.phone} className={`${FIELD_INPUT} pl-12 text-on-surface-variant`} />
                </Field>
                <Field label="Email" icon="mail" htmlFor="activate-email">
                  <input id="activate-email" readOnly value={preview.email} className={`${FIELD_INPUT} pl-12 text-on-surface-variant`} />
                </Field>
              </>
            )}
            <Field label="New password" icon="lock" htmlFor="activate-password">
              <PasswordInput id="activate-password" value={password} onChange={setPassword} placeholder="At least 6 characters" show={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            </Field>
            <Field label="Confirm password" icon="lock_reset" htmlFor="activate-confirm">
              <PasswordInput id="activate-confirm" value={confirmation} onChange={setConfirmation} placeholder="Re-enter your password" show={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            </Field>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
                <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[18px]">error</span>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 font-body text-[14px] font-semibold tracking-wide text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                  Activating...
                </>
              ) : (
                <>
                  Activate account
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-2.5 flex items-center justify-center gap-1.5 font-body text-[11px] text-on-surface-variant sm:text-[12px]">
          <span className="material-symbols-outlined text-[16px] text-outline">shield_lock</span>
          Secured by BMS Pro Trade
        </p>
      </div>
    </div>
  );
}
