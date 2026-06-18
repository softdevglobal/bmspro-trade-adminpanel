"use client";

import { FormEvent, useEffect, useRef, useState, KeyboardEvent, ClipboardEvent } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Pre-fill email (e.g. from sign-in form). */
  initialEmail?: string;
  sendCodeUrl?: string;
  resetPasswordUrl?: string;
  /** Merged into the send-code POST body (e.g. bookingSlug for customers). */
  sendExtraBody?: Record<string, unknown>;
  minPasswordLength?: number;
  /** Stack above nested modals (customer auth uses z-[200]). */
  zIndexClass?: string;
};

type Stage = "form" | "sent" | "code" | "password" | "done";

const CODE_LENGTH = 6;

export function ForgotPasswordModal({
  open,
  onClose,
  initialEmail = "",
  sendCodeUrl = "/api/auth/send-reset-code",
  resetPasswordUrl = "/api/auth/reset-password",
  sendExtraBody,
  minPasswordLength = 8,
  zIndexClass = "z-50",
}: Props) {
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState(initialEmail);
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const newPwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStage("form");
      setEmail(initialEmail);
      setDigits(Array(CODE_LENGTH).fill(""));
      setNewPassword("");
      setConfirmPassword("");
      setShowNewPw(false);
      setShowConfirmPw(false);
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [open, initialEmail]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (stage === "code") {
      setTimeout(() => digitRefs.current[0]?.focus(), 50);
    }
    if (stage === "password") {
      setTimeout(() => newPwRef.current?.focus(), 50);
    }
  }, [stage]);

  // ── Send code ────────────────────────────────────────────────
  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(sendCodeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, ...sendExtraBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to send code.");
        return;
      }
      setStage("sent");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── OTP digit handlers ───────────────────────────────────────
  function handleDigitChange(index: number, value: string) {
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < CODE_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus();
    }
  }

  function handleDigitKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  }

  function handleDigitPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = Array(CODE_LENGTH).fill("");
    pasted.split("").forEach((ch, i) => { next[i] = ch; });
    setDigits(next);
    const focusIdx = Math.min(pasted.length, CODE_LENGTH - 1);
    digitRefs.current[focusIdx]?.focus();
  }

  // ── Verify code (client-side only — full verify+reset happens on password submit) ──
  function handleVerifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = digits.join("");
    if (code.length < CODE_LENGTH) {
      setError("Please enter the full 6-digit code.");
      return;
    }
    setError(null);
    setStage("password");
  }

  // ── Reset password ────────────────────────────────────────────
  async function handleResetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newPassword.length < minPasswordLength) {
      setError(
        `Password must be at least ${minPasswordLength} characters.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(resetPasswordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code: digits.join(""),
          newPassword,
          ...sendExtraBody,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg: string = json.error ?? "Failed to reset password.";
        // Code-related errors → send back to code entry stage
        const isCodeError =
          msg.toLowerCase().includes("incorrect code") ||
          msg.toLowerCase().includes("invalid or expired") ||
          msg.toLowerCase().includes("already been used") ||
          msg.toLowerCase().includes("too many incorrect") ||
          msg.toLowerCase().includes("code has expired");
        if (isCodeError) {
          setDigits(Array(CODE_LENGTH).fill(""));
          setError(msg);
          setStage("code");
          return;
        }
        setError(msg);
        return;
      }
      setStage("done");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgot-password-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-on-background/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div className="relative w-full max-w-lg rounded-2xl border border-outline-variant bg-surface p-8 shadow-xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {/* ── Stage: form ── */}
        {stage === "form" && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[22px]">key</span>
              </div>
              <h2 id="forgot-password-title" className="font-display text-[17px] font-bold text-on-surface">
                Reset Password
              </h2>
            </div>

            <p className="mb-5 font-body text-[13px] leading-relaxed text-on-surface-variant">
              Enter your email and we&apos;ll send a 6-digit code to reset your password.
            </p>

            {error && <ErrorBanner message={error} />}

            <form onSubmit={handleSendCode} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-email" className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Email
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">mail</span>
                  <input
                    ref={emailRef}
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    suppressHydrationWarning
                    className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-12 pr-3 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-11 flex-1 items-center justify-center rounded-lg border border-outline-variant font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary font-body text-[14px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Spinner /> : "Send Code"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Stage: sent ── */}
        {stage === "sent" && (
          <>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[22px]">key</span>
              </div>
              <h2 id="forgot-password-title" className="font-display text-[17px] font-bold text-on-surface">
                Reset Password
              </h2>
            </div>

            <div className="mb-5 flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100">
                <span className="material-symbols-outlined material-symbols-filled text-[28px] text-green-600">check</span>
              </div>
              <h3 className="mb-1 font-display text-[16px] font-bold text-on-surface">Check your email</h3>
              <p className="font-body text-[13px] text-on-surface-variant">
                We&apos;ve sent a 6-digit code to{" "}
                <span className="font-semibold text-on-surface break-all">{email.trim()}</span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 flex-1 items-center justify-center rounded-lg border border-outline-variant font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => { setError(null); setStage("code"); }}
                className="flex h-11 flex-1 items-center justify-center rounded-lg bg-on-surface font-body text-[14px] font-semibold text-surface shadow-md transition-all hover:bg-on-surface/90"
              >
                Enter Code
              </button>
            </div>
          </>
        )}

        {/* ── Stage: code ── */}
        {stage === "code" && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[22px]">key</span>
              </div>
              <h2 id="forgot-password-title" className="font-display text-[17px] font-bold text-on-surface">
                Reset Password
              </h2>
            </div>

            <p className="mb-5 font-body text-[13px] leading-relaxed text-on-surface-variant">
              Enter your email and the 6-digit code sent to your email.
            </p>

            {error && <ErrorBanner message={error} />}

            <form onSubmit={handleVerifyCode} noValidate className="flex flex-col gap-4">
              {/* Email (read-only) */}
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Email
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-primary">mail</span>
                  <input
                    type="email"
                    value={email}
                    readOnly
                    suppressHydrationWarning
                    className="h-11 w-full rounded-lg border border-primary/40 bg-surface-container-low pl-12 pr-3 font-body text-body-md text-on-surface focus:outline-none"
                  />
                </div>
              </div>

              {/* 6-digit OTP */}
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Verification Code
                </label>
                <div className="flex gap-2 justify-between">
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => { digitRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(i, e)}
                      onPaste={i === 0 ? handleDigitPaste : undefined}
                      suppressHydrationWarning
                      className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-low text-center font-body text-[18px] font-bold text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  ))}
                </div>
                <p className="text-center font-body text-[11px] text-outline">
                  Enter the 6-digit code sent to your email
                </p>
              </div>

              <button
                type="submit"
                disabled={digits.join("").length < CODE_LENGTH}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-on-surface font-body text-[14px] font-semibold text-surface shadow-md transition-all hover:bg-on-surface/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Verify Code
              </button>

              <button
                type="button"
                onClick={() => { setError(null); setStage("form"); }}
                className="text-center font-body text-[13px] text-on-surface-variant hover:text-on-surface transition-colors"
              >
                ← Back to Login
              </button>
            </form>
          </>
        )}

        {/* ── Stage: password ── */}
        {stage === "password" && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[22px]">lock_reset</span>
              </div>
              <h2 id="forgot-password-title" className="font-display text-[17px] font-bold text-on-surface">
                New Password
              </h2>
            </div>

            <p className="mb-5 font-body text-[13px] leading-relaxed text-on-surface-variant">
              Choose a strong new password for your account.
            </p>

            {error && <ErrorBanner message={error} />}

            <form onSubmit={handleResetPassword} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-password" className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  New Password
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">lock</span>
                  <input
                    ref={newPwRef}
                    id="new-password"
                    type={showNewPw ? "text" : "password"}
                    required
                    placeholder={`Min. ${minPasswordLength} characters`}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    suppressHydrationWarning
                    className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-12 pr-11 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button type="button" onClick={() => setShowNewPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-outline hover:bg-surface-container hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[18px]">{showNewPw ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Confirm Password
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">lock</span>
                  <input
                    id="confirm-password"
                    type={showConfirmPw ? "text" : "password"}
                    required
                    placeholder="Repeat your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    suppressHydrationWarning
                    className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-12 pr-11 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button type="button" onClick={() => setShowConfirmPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-outline hover:bg-surface-container hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[18px]">{showConfirmPw ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !newPassword || !confirmPassword}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-body text-[14px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? <Spinner /> : "Reset Password"}
              </button>
            </form>
          </>
        )}

        {/* ── Stage: done ── */}
        {stage === "done" && (
          <div className="flex flex-col items-center py-2 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100">
              <span className="material-symbols-outlined material-symbols-filled text-[30px] text-green-600">check_circle</span>
            </div>
            <h2 id="forgot-password-title" className="mb-2 font-display text-[17px] font-bold text-on-surface">
              Password updated!
            </h2>
            <p className="mb-6 font-body text-[13px] leading-relaxed text-on-surface-variant">
              Your password has been changed successfully. You can now sign in with your new password.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-primary font-body text-[14px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
            >
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
      <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">error</span>
      <span>{message}</span>
    </div>
  );
}

function Spinner({ light }: { light?: boolean }) {
  return (
    <>
      <span className={`material-symbols-outlined animate-spin text-[18px] ${light ? "text-surface" : ""}`}>
        progress_activity
      </span>
      <span>Please wait…</span>
    </>
  );
}
