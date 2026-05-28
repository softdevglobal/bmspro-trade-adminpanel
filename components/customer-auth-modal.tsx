"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const FIREBASE_ERROR_MAP: Record<string, string> = {
  "auth/email-already-in-use":
    "An account with this email already exists. Sign in instead.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "No account found for this email.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Try again in a moment.",
};

function readError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code && FIREBASE_ERROR_MAP[code]) return FIREBASE_ERROR_MAP[code];
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

const FORM_INPUT_CLASS =
  "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-3 font-body text-[15px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:text-[14px]";

const LABEL_CLASS =
  "block font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant";

type Mode = "signin" | "signup";

export function CustomerAuthPanel({
  businessName,
  variant = "page",
  defaultMode = "signin",
  defaults,
  onAuthenticated,
}: {
  businessName: string;
  variant?: "page" | "modal";
  defaultMode?: Mode;
  defaults?: {
    fullName?: string;
    phone?: string;
    email?: string;
  };
  onAuthenticated?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  const containerClass =
    variant === "modal"
      ? "relative w-full"
      : "relative w-full min-w-0 sm:overflow-hidden sm:rounded-[24px] sm:border sm:border-stone-200/90 sm:bg-white/95 sm:p-8 sm:shadow-[0_12px_40px_-18px_rgba(31,29,26,0.14)]";

  return (
    <div className={containerClass}>
      <div className="space-y-4 text-on-surface">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-[#faf8f5] px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-stone-600">
            <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
              {mode === "signup" ? "person_add" : "lock"}
            </span>
            {mode === "signup" ? "Create account" : "Sign in"}
          </div>
          <h3 className="mt-2 font-display text-[20px] font-semibold leading-snug text-on-surface sm:text-headline-md">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h3>
          <p className="mt-1 font-body text-[14px] leading-snug text-on-surface-variant">
            {mode === "signin"
              ? `Sign in to send your request to ${businessName}.`
              : `Set up a quick account to send this booking with ${businessName}.`}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-stone-200 bg-[#faf8f5] p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-lg px-3 py-1.5 font-body text-[12px] font-bold uppercase tracking-wider transition-colors ${
              mode === "signin"
                ? "bg-white text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-lg px-3 py-1.5 font-body text-[12px] font-bold uppercase tracking-wider transition-colors ${
              mode === "signup"
                ? "bg-white text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            New account
          </button>
        </div>

        {mode === "signin" ? (
          <SignInForm
            defaultEmail={defaults?.email}
            onAuthenticated={onAuthenticated}
          />
        ) : (
          <SignUpForm defaults={defaults} onAuthenticated={onAuthenticated} />
        )}
      </div>
    </div>
  );
}

export function CustomerAuthModal({
  open,
  onClose,
  businessName,
  defaults,
  onAuthenticated,
  defaultMode,
}: {
  open: boolean;
  onClose: () => void;
  businessName: string;
  defaults?: { fullName?: string; phone?: string; email?: string };
  onAuthenticated?: () => void;
  defaultMode?: Mode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center px-3 py-4 sm:items-center sm:px-6 sm:py-10">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-auth-dialog-title"
        className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 shadow-[0_24px_60px_-12px_rgba(31,29,26,0.4)] sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-on-surface-variant shadow-sm transition-colors hover:border-stone-300 hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
        <div id="customer-auth-dialog-title" className="sr-only">
          {defaultMode === "signup" ? "Create account" : "Sign in"}
        </div>
        <CustomerAuthPanel
          businessName={businessName}
          variant="modal"
          defaultMode={defaultMode}
          defaults={defaults}
          onAuthenticated={onAuthenticated}
        />
      </div>
    </div>,
    document.body,
  );
}

function SignInForm({
  defaultEmail,
  onAuthenticated,
}: {
  defaultEmail?: string;
  onAuthenticated?: () => void;
}) {
  const { login, resetPassword } = useCustomerAuth();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onAuthenticated?.();
    } catch (err) {
      setError(readError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Enter your email to receive a reset link.");
      return;
    }
    try {
      await resetPassword(email);
      setInfo("Password reset email sent. Check your inbox.");
    } catch (err) {
      setError(readError(err));
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block">
        <span className={LABEL_CLASS}>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@email.com"
          className={FORM_INPUT_CLASS}
        />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 6 characters"
          className={FORM_INPUT_CLASS}
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-body text-[12px] font-semibold text-emerald-700">
          {info}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="font-body text-[12px] font-semibold text-primary hover:underline"
        >
          Forgot password?
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-bold text-on-primary shadow-sm transition-opacity disabled:opacity-60"
        >
          {submitting ? (
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
          ) : (
            <span className="material-symbols-outlined text-[16px]">login</span>
          )}
          Sign in
        </button>
      </div>
    </form>
  );
}

function SignUpForm({
  defaults,
  onAuthenticated,
}: {
  defaults?: { fullName?: string; phone?: string; email?: string };
  onAuthenticated?: () => void;
}) {
  const { register } = useCustomerAuth();
  const [fullName, setFullName] = useState(defaults?.fullName ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 6) {
      setError("Enter a valid mobile number.");
      return;
    }
    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await register({ email, password, fullName, phone });
      onAuthenticated?.();
    } catch (err) {
      setError(readError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block">
        <span className={LABEL_CLASS}>Full name</span>
        <input
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="e.g. Alex Thompson"
          className={FORM_INPUT_CLASS}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLASS}>Mobile</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="07XXXXXXXX"
            className={FORM_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@email.com"
            className={FORM_INPUT_CLASS}
          />
        </label>
      </div>

      <label className="block">
        <span className={LABEL_CLASS}>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 6 characters"
          className={FORM_INPUT_CLASS}
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-bold text-on-primary shadow-sm transition-opacity disabled:opacity-60"
      >
        {submitting ? (
          <span className="material-symbols-outlined animate-spin text-[16px]">
            progress_activity
          </span>
        ) : (
          <span className="material-symbols-outlined text-[16px]">
            person_add
          </span>
        )}
        Create account &amp; continue
      </button>
    </form>
  );
}
