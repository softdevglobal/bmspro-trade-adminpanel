"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfileActions } from "@/lib/business/use-business-profile";
import { DEFAULT_SLOT_CAPACITY } from "@/lib/calendar/slot-capacity";
import { useEffect, useState } from "react";

type Props = {
  slotCapacityJobs: number | null;
  slotCapacityInspectionRequests: number | null;
  loading?: boolean;
  onSaved?: (capacity: {
    slotCapacityJobs: number;
    slotCapacityInspectionRequests: number;
  }) => void;
};

export function BusinessSlotCapacitySettings({
  slotCapacityJobs,
  slotCapacityInspectionRequests,
  loading = false,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const profileActions = useBusinessProfileActions();
  const [jobsPerHour, setJobsPerHour] = useState(
    String(slotCapacityJobs ?? DEFAULT_SLOT_CAPACITY.maxJobsPerHour),
  );
  const [requestsPerHour, setRequestsPerHour] = useState(
    String(
      slotCapacityInspectionRequests ??
        DEFAULT_SLOT_CAPACITY.maxInspectionsPerHour,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setJobsPerHour(
      String(slotCapacityJobs ?? DEFAULT_SLOT_CAPACITY.maxJobsPerHour),
    );
    setRequestsPerHour(
      String(
        slotCapacityInspectionRequests ??
          DEFAULT_SLOT_CAPACITY.maxInspectionsPerHour,
      ),
    );
  }, [slotCapacityJobs, slotCapacityInspectionRequests]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          slotCapacityJobs: Number.parseInt(jobsPerHour, 10),
          slotCapacityInspectionRequests: Number.parseInt(requestsPerHour, 10),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: {
          slotCapacityJobs?: number | null;
          slotCapacityInspectionRequests?: number | null;
        };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save slot capacity.");
      }
      const nextJobs =
        typeof payload.profile?.slotCapacityJobs === "number"
          ? payload.profile.slotCapacityJobs
          : Number.parseInt(jobsPerHour, 10);
      const nextRequests =
        typeof payload.profile?.slotCapacityInspectionRequests === "number"
          ? payload.profile.slotCapacityInspectionRequests
          : Number.parseInt(requestsPerHour, 10);
      onSaved?.({
        slotCapacityJobs: nextJobs,
        slotCapacityInspectionRequests: nextRequests,
      });
      setSuccess(true);
      profileActions?.mergeBusinessProfile({});
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save slot capacity.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="Calendar slot capacity"
      description="How many jobs and inspection requests can be scheduled in the same one-hour slot."
      icon="calendar_month"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Jobs per hour
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={jobsPerHour}
            disabled={loading || saving}
            onChange={(event) => setJobsPerHour(event.target.value)}
            className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </label>
        <label className="block">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Inspection requests per hour
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={requestsPerHour}
            disabled={loading || saving}
            onChange={(event) => setRequestsPerHour(event.target.value)}
            className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 font-body text-[13px] text-error">{error}</p>
      ) : null}
      {success ? (
        <p className="mt-3 font-body text-[13px] text-green-700">
          Slot capacity saved.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="rounded-xl bg-primary px-4 py-2.5 font-body text-[14px] font-semibold text-on-primary disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save capacity"}
        </button>
      </div>
    </SettingsSection>
  );
}
