"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile, useBusinessProfileActions } from "@/lib/business/use-business-profile";

type Permission = "sophieTalkEnabled" | "sophieLiveListenEnabled" | "sophieMissedCallbacksEnabled" | "sophieInvoiceCallsEnabled";
const options: { key: Permission; label: string; description: string }[] = [
  { key: "sophieTalkEnabled", label: "Talk to Sophie", description: "Use Sophie’s voice assistant from the dashboard." },
  { key: "sophieLiveListenEnabled", label: "Listen live", description: "Listen to Sophie’s active calls for this business." },
  { key: "sophieMissedCallbacksEnabled", label: "Automatic missed-call follow-ups", description: "Allow Sophie to return missed calls automatically when the DID mapping also has automatic callbacks enabled." },
  { key: "sophieInvoiceCallsEnabled", label: "Sophie invoice calls", description: "Allow owner-started calls about overdue invoices. Automatic overdue calls also require the platform rollout switch. Off by default." },
];

export function SophieVoicePermissions() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const actions = useBusinessProfileActions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [hours, setHours] = useState({ start: "09:00", end: "17:00", weekdaysOnly: true });
  const [hoursSaved, setHoursSaved] = useState(false);

  useEffect(() => {
    if (profile?.sophieCallingHours) setHours(profile.sophieCallingHours);
  }, [profile?.sophieCallingHours]);

  async function save(patch: Record<string, unknown>) {
    if (!user || !profile || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/business/sophie-permissions", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save Sophie permissions.");
      actions?.mergeBusinessProfile({
        ...(typeof result.sophieTalkEnabled === "boolean" && { sophieTalkEnabled: result.sophieTalkEnabled }),
        ...(typeof result.sophieLiveListenEnabled === "boolean" && { sophieLiveListenEnabled: result.sophieLiveListenEnabled }),
        ...(typeof result.sophieMissedCallbacksEnabled === "boolean" && { sophieMissedCallbacksEnabled: result.sophieMissedCallbacksEnabled }),
        ...(typeof result.sophieInvoiceCallsEnabled === "boolean" && { sophieInvoiceCallsEnabled: result.sophieInvoiceCallsEnabled }),
        ...(result.sophieCallingHours && { sophieCallingHours: result.sophieCallingHours }),
      });
      setHoursSaved("sophieCallingHours" in result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Sophie permissions.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-display text-sm font-semibold text-on-surface">Voice permissions</h4>
      <div className="space-y-3">
        {options.map(({ key, label, description }) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant px-3 py-3">
            <span>
              <span className="block text-sm font-semibold text-on-surface">{label}</span>
              <span className="block text-xs text-on-surface-variant">{description}</span>
            </span>
            <input type="checkbox" role="switch" aria-label={label} checked={profile?.[key] === true}
              disabled={!profile || saving} onChange={event => void save({ [key]: event.target.checked })}
              className="h-4 w-4 shrink-0 accent-primary disabled:opacity-50" />
          </label>
        ))}
        <div className="space-y-3 rounded-xl border border-outline-variant px-3 py-3">
          <div>
            <span className="block text-sm font-semibold text-on-surface">Outbound calling hours</span>
            <span className="block text-xs text-on-surface-variant">Automatic calls use your business timezone ({profile?.timezone ?? "business timezone"}). Outside these hours they wait until the next allowed time.</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-on-surface-variant">From
              <input type="time" value={hours.start} onChange={event => { setHours(current => ({ ...current, start: event.target.value })); setHoursSaved(false); }}
                className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface" />
            </label>
            <label className="grid gap-1 text-xs text-on-surface-variant">Until
              <input type="time" value={hours.end} onChange={event => { setHours(current => ({ ...current, end: event.target.value })); setHoursSaved(false); }}
                className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface" />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-on-surface">
              <input type="checkbox" checked={hours.weekdaysOnly} onChange={event => { setHours(current => ({ ...current, weekdaysOnly: event.target.checked })); setHoursSaved(false); }} />
              Weekdays only
            </label>
            <button type="button" disabled={!profile || saving || hours.start >= hours.end}
              onClick={() => void save({ sophieCallingHours: hours })}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:opacity-50">
              Save calling hours
            </button>
          </div>
          {hoursSaved && <p role="status" className="text-xs text-primary">Calling hours saved.</p>}
          {hours.start >= hours.end && <p role="alert" className="text-xs text-error">The end time must be later than the start time.</p>}
        </div>
        {saving && <p role="status" className="text-xs text-on-surface-variant">Saving permissions…</p>}
        {error && <p role="alert" className="text-xs text-error">{error}</p>}
      </div>
    </div>
  );
}
