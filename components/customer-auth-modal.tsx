"use client";

import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import { useEffect, useState, type ReactNode } from "react";
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

const FIELD_LABEL =
  "font-body text-[13px] font-semibold tracking-wide text-on-surface-variant";

const FIELD_INPUT =
  "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

const FIELD_INPUT_COMPACT =
  "h-10 w-full rounded-lg border border-outline-variant bg-surface-container-low font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

/** Full-width email in the booking modal — room for longer addresses. */
const FIELD_INPUT_EMAIL_MODAL =
  "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low font-body text-[15px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

type Mode = "signin" | "signup";

function AuthMessage({
  variant,
  children,
}: {
  variant: "error" | "info";
  children: string;
}) {
  const isError = variant === "error";
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 font-body text-[13px] ${
        isError
          ? "border-error/30 bg-error-container/60 text-on-error-container"
          : "border-emerald-200/80 bg-emerald-50 text-emerald-800"
      }`}
    >
      <span
        className={`material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[18px] ${
          isError ? "text-error" : "text-emerald-600"
        }`}
      >
        {isError ? "error" : "check_circle"}
      </span>
      <span>{children}</span>
    </div>
  );
}

function AuthField({
  label,
  icon,
  htmlFor,
  children,
  action,
}: {
  label: string;
  icon: string;
  htmlFor?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className={FIELD_LABEL}>
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}

function ModeTabs({
  mode,
  onSignIn,
  onSignUp,
}: {
  mode: Mode;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl border border-outline-variant bg-surface-container-low p-1"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "signin"}
        onClick={onSignIn}
        className={`rounded-lg px-3 py-2 font-body text-[13px] font-semibold transition-all ${
          mode === "signin"
            ? "bg-surface-container-lowest text-primary shadow-sm ring-1 ring-outline-variant/60"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Sign in
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "signup"}
        onClick={onSignUp}
        className={`rounded-lg px-3 py-2 font-body text-[13px] font-semibold transition-all ${
          mode === "signup"
            ? "bg-surface-container-lowest text-primary shadow-sm ring-1 ring-outline-variant/60"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Join
      </button>
    </div>
  );
}

function SubmitButton({
  loading,
  loadingLabel,
  label,
  icon,
  compact,
}: {
  loading: boolean;
  loadingLabel: string;
  label: string;
  icon: string;
  compact?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 font-body font-semibold tracking-wide text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 ${
        compact ? "mt-0 h-10 text-[13px]" : "mt-1 h-11 text-[14px]"
      }`}
    >
      {loading ? (
        <>
          <span className="material-symbols-outlined animate-spin text-[18px]">
            progress_activity
          </span>
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </>
      )}
    </button>
  );
}

export function CustomerAuthPanel({
  businessName,
  bookingSlug,
  variant = "page",
  defaultMode = "signin",
  mode: controlledMode,
  onModeChange,
  defaults,
  onAuthenticated,
}: {
  businessName: string;
  bookingSlug?: string;
  variant?: "page" | "modal";
  defaultMode?: Mode;
  mode?: Mode;
  onModeChange?: (mode: Mode) => void;
  defaults?: {
    fullName?: string;
    phone?: string;
    email?: string;
  };
  onAuthenticated?: () => void;
}) {
  const [internalMode, setInternalMode] = useState<Mode>(defaultMode);
  const mode = controlledMode ?? internalMode;
  const setMode = onModeChange ?? setInternalMode;

  useEffect(() => {
    if (controlledMode === undefined) {
      setInternalMode(defaultMode);
    }
  }, [defaultMode, controlledMode]);

  const tabs = (
    <ModeTabs
      mode={mode}
      onSignIn={() => setMode("signin")}
      onSignUp={() => setMode("signup")}
    />
  );

  const forms =
    mode === "signin" ? (
      <SignInForm
        layout={variant === "modal" ? "modal" : "default"}
        defaultEmail={defaults?.email}
        onAuthenticated={onAuthenticated}
      />
    ) : (
      <SignUpForm
        layout={variant === "modal" ? "modal" : "default"}
        defaults={defaults}
        bookingSlug={bookingSlug}
        onAuthenticated={onAuthenticated}
      />
    );

  const formBlock = (
    <>
      {tabs}
      {forms}
    </>
  );

  if (variant === "modal") {
    return <div className="flex flex-col gap-3">{formBlock}</div>;
  }

  return (
    <div className="relative w-full min-w-0 sm:overflow-hidden sm:rounded-[24px] sm:border sm:border-outline-variant sm:bg-surface-container-lowest sm:p-8 sm:shadow-[0_12px_40px_-18px_rgba(31,29,26,0.14)]">
      <header className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Customer booking
        </span>
        <h2 className="mt-3 font-display text-[26px] font-semibold text-on-surface">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          {mode === "signin"
            ? `Sign in to send your request to ${businessName}.`
            : `Set up a quick account to book with ${businessName}.`}
        </p>
      </header>
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:p-6">
        {formBlock}
      </div>
    </div>
  );
}

export function CustomerAuthModal({
  open,
  onClose,
  businessName,
  bookingSlug,
  defaults,
  onAuthenticated,
  defaultMode,
}: {
  open: boolean;
  onClose: () => void;
  businessName: string;
  bookingSlug?: string;
  defaults?: { fullName?: string; phone?: string; email?: string };
  onAuthenticated?: () => void;
  defaultMode?: Mode;
}) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>(defaultMode ?? "signin");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setMode(defaultMode ?? "signin");
  }, [defaultMode, open]);

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

  const title = mode === "signup" ? "Create account" : "Sign in";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-on-background/55 backdrop-blur-[6px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-auth-dialog-title"
        className="relative z-10 flex w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-[0_24px_60px_-12px_rgba(15,23,42,0.22)] sm:max-w-[480px]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Brand strip — admin-style accent */}
        <div className="relative shrink-0 border-b border-outline-variant bg-gradient-to-r from-primary/[0.07] via-surface-container-low to-background px-4 py-3 pr-12 sm:px-5 sm:py-3.5">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl"
          />
          <div className="relative flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary shadow-md shadow-primary/25">
              <span className="material-symbols-outlined material-symbols-filled text-[20px]">
                storefront
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Booking with
              </p>
              <p className="truncate font-display text-[17px] font-semibold text-on-surface">
                {businessName}
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest/90 text-on-surface-variant shadow-sm transition-colors hover:border-outline hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5 sm:pt-4">
          <header className="mb-3 text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-0.5 font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {title}
            </span>
            <h2
              id="customer-auth-dialog-title"
              className="mt-2 font-display text-[20px] font-semibold leading-tight text-on-surface sm:text-[24px]"
            >
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-0.5 font-body text-[13px] leading-snug text-on-surface-variant">
              {mode === "signin"
                ? "Sign in to send your booking request."
                : "Quick setup to submit your visit request."}
            </p>
          </header>

          <div className="rounded-xl border border-outline-variant bg-background p-3 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:rounded-2xl sm:p-4">
            <CustomerAuthPanel
              businessName={businessName}
              bookingSlug={bookingSlug}
              variant="modal"
              mode={mode}
              onModeChange={setMode}
              defaults={defaults}
              onAuthenticated={onAuthenticated}
            />
          </div>

          <p className="mt-2.5 flex items-center justify-center gap-1.5 font-body text-[11px] text-on-surface-variant sm:text-[12px]">
            <span className="material-symbols-outlined text-[16px] text-outline">
              shield_lock
            </span>
            Secured by BMS Pro Trade
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SignInForm({
  layout = "default",
  defaultEmail,
  onAuthenticated,
}: {
  layout?: "default" | "modal";
  defaultEmail?: string;
  onAuthenticated?: () => void;
}) {
  const { login, resetPassword } = useCustomerAuth();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const compact = layout === "modal";
  const inputClass = compact ? FIELD_INPUT_COMPACT : FIELD_INPUT;
  const emailInputClass = compact ? FIELD_INPUT_EMAIL_MODAL : FIELD_INPUT;
  const gap = compact ? "gap-3" : "gap-4";

  return (
    <form className={`flex flex-col ${gap}`} onSubmit={handleSubmit} noValidate>
      {error ? <AuthMessage variant="error">{error}</AuthMessage> : null}
      {info ? <AuthMessage variant="info">{info}</AuthMessage> : null}

      <AuthField label="Email address" icon="mail" htmlFor="customer-signin-email">
        <input
          id="customer-signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@email.com"
          className={`${emailInputClass} pl-12 pr-3`}
        />
      </AuthField>

      <AuthField
        label="Password"
        icon="lock"
        htmlFor="customer-signin-password"
        action={
          <button
            type="button"
            onClick={handleReset}
            className="font-body text-[13px] font-semibold text-primary hover:text-primary/80"
          >
            Forgot?
          </button>
        }
      >
        <input
          id="customer-signin-password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          className={`${inputClass} pl-12 pr-11`}
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {showPassword ? "visibility_off" : "visibility"}
          </span>
        </button>
      </AuthField>

      <SubmitButton
        compact={compact}
        loading={submitting}
        loadingLabel="Signing in..."
        label="Sign in"
        icon="arrow_forward"
      />
    </form>
  );
}

function SignUpForm({
  layout = "default",
  defaults,
  bookingSlug,
  onAuthenticated,
}: {
  layout?: "default" | "modal";
  defaults?: { fullName?: string; phone?: string; email?: string };
  bookingSlug?: string;
  onAuthenticated?: () => void;
}) {
  const { register } = useCustomerAuth();
  const [fullName, setFullName] = useState(defaults?.fullName ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      await register({ email, password, fullName, phone, bookingSlug });
      onAuthenticated?.();
    } catch (err) {
      setError(readError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const compact = layout === "modal";
  const inputClass = compact ? FIELD_INPUT_COMPACT : FIELD_INPUT;
  const emailInputClass = compact ? FIELD_INPUT_EMAIL_MODAL : FIELD_INPUT;
  const gap = compact ? "gap-3" : "gap-4";
  const contactGrid = "grid gap-4 sm:grid-cols-2";

  return (
    <form className={`flex flex-col ${gap}`} onSubmit={handleSubmit} noValidate>
      {error ? <AuthMessage variant="error">{error}</AuthMessage> : null}

      <AuthField label="Full name" icon="person" htmlFor="customer-signup-name">
        <input
          id="customer-signup-name"
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="e.g. Alex Thompson"
          className={`${inputClass} pl-12 pr-3`}
        />
      </AuthField>

      {compact ? (
        <>
          <AuthField label="Mobile" icon="call" htmlFor="customer-signup-phone">
            <input
              id="customer-signup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="07XXXXXXXX"
              className={`${inputClass} pl-12 pr-3`}
            />
          </AuthField>
          <AuthField label="Email" icon="mail" htmlFor="customer-signup-email">
            <input
              id="customer-signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@email.com"
              className={`${emailInputClass} pl-12 pr-3`}
            />
          </AuthField>
        </>
      ) : (
        <div className={contactGrid}>
          <AuthField label="Mobile" icon="call" htmlFor="customer-signup-phone">
            <input
              id="customer-signup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="07XXXXXXXX"
              className={`${inputClass} pl-12 pr-3`}
            />
          </AuthField>
          <AuthField label="Email" icon="mail" htmlFor="customer-signup-email">
            <input
              id="customer-signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@email.com"
              className={`${emailInputClass} pl-12 pr-3`}
            />
          </AuthField>
        </div>
      )}

      <AuthField label="Password" icon="lock" htmlFor="customer-signup-password">
        <input
          id="customer-signup-password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 6 characters"
          className={`${inputClass} pl-12 pr-11`}
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {showPassword ? "visibility_off" : "visibility"}
          </span>
        </button>
      </AuthField>

      <SubmitButton
        compact={compact}
        loading={submitting}
        loadingLabel="Creating account..."
        label="Create account"
        icon="arrow_forward"
      />
    </form>
  );
}
