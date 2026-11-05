"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useState } from "react";

type SavedPermissions = { inspections: boolean; jobs: boolean };
type Props = { enabled: boolean; jobsEnabled: boolean; loading?: boolean; onSaved?: (saved: SavedPermissions) => void };

export function BusinessAiBookingSettings({ enabled, jobsEnabled, loading = false, onSaved }: Props) {
  const { user } = useAuth();
  const [value, setValue] = useState(enabled);
  const [jobsValue, setJobsValue] = useState(jobsEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync the toggles when saved values arrive from the parent.
  const [synced, setSynced] = useState({ enabled, jobsEnabled });
  if (synced.enabled !== enabled || synced.jobsEnabled !== jobsEnabled) {
    setSynced({ enabled, jobsEnabled });
    setValue(enabled);
    setJobsValue(jobsEnabled);
  }

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
        body: JSON.stringify({ sophieBookingAuthority: value, sophieJobAuthority: jobsValue }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; profile?: { sophieBookingAuthority?: boolean; sophieJobAuthority?: boolean } };
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save Sophie booking permissions.");
      const next = { inspections: result.profile?.sophieBookingAuthority === true, jobs: result.profile?.sophieJobAuthority === true };
      setValue(next.inspections);
      setJobsValue(next.jobs);
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
      description="Choose what Sophie can confirm by herself for inspections and jobs."
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
                Existing-service requests need a qualified staff member. Advice requests need an inspector permitted to receive quotation requests. Both need an available preferred visit time; otherwise they stay pending for your review. This applies to new customer portal and Sophie requests.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={value}
              onChange={(event) => { setValue(event.target.checked); setSaved(false); setError(null); }}
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3.5">
            <span className="min-w-0">
              <span className="block font-body text-[13px] font-semibold text-on-surface">Allow Sophie to confirm, reschedule and cancel jobs</span>
              <span className="mt-1 block font-body text-[12px] leading-relaxed text-on-surface-variant">
                Callers can always ask for a job on an existing service. With this on, Sophie books it at an exact time with a qualified, available staff member; otherwise it waits under Site inspections for you to choose Create job. With their job reference, email and phone, callers can also move or cancel a confirmed job. Recurring, multi-day and started jobs stay with your team. Sophie never quotes a price: set it before invoicing. Advice work still goes through an inspection.</span>
            </span>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={jobsValue}
              onChange={(event) => { setJobsValue(event.target.checked); setSaved(false); setError(null); }}
            />
          </label>
          {error ? <p role="alert" className="font-body text-[12px] text-error">{error}</p> : null}
          {saved ? <p role="status" className="font-body text-[12px] text-primary">Booking permissions saved.</p> : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || (value === enabled && jobsValue === jobsEnabled)}
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
