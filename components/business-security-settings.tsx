"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { auth } from "@/lib/firebase/client";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { useState } from "react";

const MIN_PASSWORD_LENGTH = 8;

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-outline-variant bg-surface-container-low pl-11 pr-11 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
      <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        {label}
      </span>
      <div className="relative mt-2">
        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-outline">
          {icon}
        </span>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={
            id === "current-password"
              ? "current-password"
              : id === "new-password"
                ? "new-password"
                : "new-password"
          }
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container hover:text-primary disabled:opacity-60"
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

export function BusinessSecuritySettings() {
  const { user } = useAuth();
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
    if (!user?.email) {
      setError("No signed-in account found.");
      return;
    }

    if (!currentPassword.trim()) {
      setError("Enter your current password.");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
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
        user.email,
        currentPassword,
      );
      await reauthenticateWithCredential(auth.currentUser ?? user, credential);
      await updatePassword(auth.currentUser ?? user, newPassword);

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
    <SettingsSection
      icon="shield"
      title="Security"
      description="Update your account password for better security."
    >
      <div className="space-y-4">
        <PasswordField
          id="current-password"
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
          id="new-password"
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
          id="confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          placeholder="Confirm your new password"
          icon="lock"
          disabled={saving}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          onChange={setConfirmPassword}
        />

        <div className="flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            disabled={
              saving ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
            onClick={() => void handleChangePassword()}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <span className="material-symbols-outlined text-[18px]">key</span>
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>

        {error ? (
          <p className="font-body text-[12px] font-semibold text-error">{error}</p>
        ) : null}
        {notice ? (
          <p className="font-body text-[12px] font-semibold text-primary">{notice}</p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
