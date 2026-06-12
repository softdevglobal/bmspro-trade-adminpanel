"use client";

import { AuPhoneInput } from "@/components/au-phone-input";
import type { ProfileFormState } from "@/components/business-settings-panel";
import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useState } from "react";

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const READONLY_INPUT_CLASS =
  "mt-2 w-full cursor-default rounded-xl border border-outline-variant/70 bg-surface-container/80 px-3 py-2.5 font-body text-[14px] text-on-surface-variant";

type Props = {
  form: ProfileFormState;
  onFormChange: (form: ProfileFormState) => void;
  onSaved: (form: ProfileFormState) => void;
  loading?: boolean;
};

export function BusinessProfileSettings({
  form,
  onFormChange,
  onSaved,
  loading = false,
}: Props) {
  const { user } = useAuth();
  const liveProfile = useBusinessProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateField<K extends keyof ProfileFormState>(
    key: K,
    value: ProfileFormState[K],
  ) {
    onFormChange({ ...form, [key]: value });
  }

  async function handleSave() {
    if (!user) return;

    setSaving(true);
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
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          businessAddress: form.businessAddress.trim() || null,
          businessPhone: form.businessPhone.trim() || null,
          abn: form.abn.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: {
          businessName?: string | null;
          businessAddress?: string | null;
          businessEmail?: string | null;
          businessPhone?: string | null;
          abn?: string | null;
        };
      };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not save business profile.");
      }
      const p = payload.profile;
      const next: ProfileFormState = {
        businessName: p.businessName ?? "",
        businessAddress: p.businessAddress ?? "",
        businessEmail: p.businessEmail ?? "",
        businessPhone: p.businessPhone ?? "",
        abn: p.abn ?? "",
      };
      onSaved(next);
      setNotice("Business profile saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save business profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  const displayName =
    liveProfile?.businessName?.trim() || form.businessName.trim() || "Your business";

  const accountEmail =
    user?.email?.trim() || form.businessEmail.trim() || "—";

  return (
    <SettingsSection
      icon="store"
      title="Business profile"
      description="Company details shown on your public page, quotations, and invoices."
    >
      {loading ? (
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading business profile…
        </p>
      ) : (
        <div className="space-y-5">
          <p className="rounded-xl bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
            Editing profile for{" "}
            <span className="font-semibold text-on-surface">{displayName}</span>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business name
              </span>
              <input
                type="text"
                value={form.businessName}
                disabled={saving}
                onChange={(e) => updateField("businessName", e.target.value)}
                className={INPUT_CLASS}
                maxLength={120}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business address
              </span>
              <input
                type="text"
                value={form.businessAddress}
                disabled={saving}
                onChange={(e) => updateField("businessAddress", e.target.value)}
                className={INPUT_CLASS}
                maxLength={300}
                placeholder="Street, suburb, state, postcode"
              />
            </label>

            <label className="block">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business email
              </span>
              <input
                type="email"
                readOnly
                tabIndex={-1}
                value={accountEmail}
                className={READONLY_INPUT_CLASS}
                aria-readonly="true"
              />
              <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
                Your sign-in email. Shown on quotations and invoices.
              </span>
            </label>

            <label className="block">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business phone
              </span>
              <AuPhoneInput
                value={form.businessPhone}
                disabled={saving}
                onChange={(value) => updateField("businessPhone", value)}
                size="md"
                className="mt-1"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                ABN
              </span>
              <input
                type="text"
                value={form.abn}
                disabled={saving}
                onChange={(e) => updateField("abn", e.target.value)}
                className={INPUT_CLASS}
                maxLength={20}
                placeholder="11 digit Australian Business Number"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving…" : "Save business profile"}
            </button>
          </div>

          {error ? (
            <p className="font-body text-[12px] font-semibold text-error">{error}</p>
          ) : null}
          {notice ? (
            <p className="font-body text-[12px] font-semibold text-primary">{notice}</p>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
