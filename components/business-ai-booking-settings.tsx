"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useState } from "react";

type Props = { enabled: boolean; loading?: boolean; onSaved?: (enabled: boolean) => void };

export function BusinessAiBookingSettings({ enabled, loading = false, onSaved }: Props) {
  const { user } = useAuth();
  const [value, setValue] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setValue(enabled), [enabled]);

  async function save() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sophieBookingAuthority: value }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; profile?: { sophieBookingAuthority?: boolean } };
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save Sophie booking permissions.");
      const next = result.profile?.sophieBookingAuthority === true;
      setValue(next);
      onSaved?.(next);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Sophie booking permissions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="Sophie booking authority"
      description="Choose whether Sophie can automatically assign an eligible inspector and confirm new inspection requests."
      icon="smart_toy"
    >
      {loading ? (
        <div className="flex items-center gap-2 font-body text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[18px] text-primary">progress_activity</span>
          Loading booking permissions…
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3.5">
            <span className="min-w-0">
              <span className="block font-body text-[13px] font-semibold text-on-surface">Allow Sophie to assign staff and confirm bookings</span>
              <span className="mt-1 block font-body text-[12px] leading-relaxed text-on-surface-variant">
                Only requests with an eligible service, available staff member, and valid preferred visit time are confirmed. Other requests stay pending for your review. This applies to new customer portal and Sophie requests.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={value}
              onChange={(event) => { setValue(event.target.checked); setSaved(false); setError(null); }}
            />
          </label>
          {error ? <p role="alert" className="font-body text-[12px] text-error">{error}</p> : null}
          {saved ? <p role="status" className="font-body text-[12px] text-primary">Booking permissions saved.</p> : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || value === enabled}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 font-body text-[13px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <span className="material-symbols-outlined animate-spin text-[17px]">progress_activity</span> : null}
            {saving ? "Saving…" : "Save booking permissions"}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
