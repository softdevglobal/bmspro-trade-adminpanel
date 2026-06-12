"use client";

import { customerAuth } from "@/lib/firebase/customer-client";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { useState } from "react";

const MIN_PASSWORD_LENGTH = 6;

const INPUT_CLASS =
  "w-full rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-11 font-body text-[15px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:text-[14px]";

function firebasePasswordError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: string }).code)
      : "";

  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "Current password is incorrect.";
  }
  if (code === "auth/weak-password") {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (code === "auth/requires-recent-login") {
    return "Please sign out and sign in again, then try changing your password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment and try again.";
  }

  return err instanceof Error
    ? err.message
    : "Could not change password. Please try again.";
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  icon: string;
  disabled: boolean;
  show: boolean;
  onToggleShow: () => void;
  onChange: (value: string) => void;
};

function PasswordField({
  id,
  label,
  value,
  placeholder,
  icon,
  disabled,
  show,
  onToggleShow,
  onChange,
}: PasswordFieldProps) {
  return (
    <label className="block">
      <span className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div className="relative mt-2">
        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
          {icon}
        </span>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={
            id === "customer-current-password"
              ? "current-password"
              : "new-password"
          }
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-stone-100 hover:text-primary disabled:opacity-60"
          aria-label={show ? "Hide password" : "Show password"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {show ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
    </label>
  );
}

export function CustomerSecuritySettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleChangePassword() {
    const current = customerAuth.currentUser;
    if (!current?.email) {
      setError("No signed-in account found.");
      return;
    }

    if (!currentPassword.trim()) {
      setError("Enter your current password.");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const credential = EmailAuthProvider.credential(
        current.email,
        currentPassword,
      );
      await reauthenticateWithCredential(current, credential);
      await updatePassword(current, newPassword);

      try {
        const token = await current.getIdToken();
        await fetch("/api/audit/password-change", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* audit is best-effort */
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed successfully.");
    } catch (err) {
      setError(firebasePasswordError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
      <div className="flex items-start gap-3 border-b border-stone-100 pb-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-on-surface">
          <span className="material-symbols-outlined text-[20px]">shield</span>
        </span>
        <div>
          <h2 className="font-display text-[18px] font-semibold text-on-surface">
            Security
          </h2>
          <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
            Update your account password for better security.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <PasswordField
          id="customer-current-password"
          label="Current password"
          value={currentPassword}
          placeholder="Enter your current password"
          icon="lock"
          disabled={saving}
          show={showCurrent}
          onToggleShow={() => setShowCurrent((v) => !v)}
          onChange={setCurrentPassword}
        />

        <PasswordField
          id="customer-new-password"
          label="New password"
          value={newPassword}
          placeholder="Enter your new password"
          icon="key"
          disabled={saving}
          show={showNew}
          onToggleShow={() => setShowNew((v) => !v)}
          onChange={setNewPassword}
        />

        <PasswordField
          id="customer-confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          placeholder="Confirm your new password"
          icon="lock"
          disabled={saving}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          onChange={setConfirmPassword}
        />

        <div className="flex flex-col gap-2 border-t border-stone-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            disabled={
              saving || !currentPassword || !newPassword || !confirmPassword
            }
            onClick={() => void handleChangePassword()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-body text-[14px] font-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <span className="material-symbols-outlined text-[18px]">key</span>
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>

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
      </div>
    </div>
  );
}
