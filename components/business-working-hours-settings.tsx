"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import {
  DEFAULT_WORKING_HOURS,
  describeWorkingHoursWindow,
  WEEKDAY_NAMES,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { useEffect, useState } from "react";

type Props = {
  workingHours: BusinessWorkingHours | null;
  /** Open weekdays (0 = Sunday); null until set. Sophie answers "are you open?" only once they are. */
  openDays?: number[] | null;
  loading?: boolean;
  onSaved?: (workingHours: BusinessWorkingHours, openDays?: number[] | null) => void;
};

/** Monday first, as Australian calendars show it. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function toTimeInputValue(clock: string): string {
  return clock.length >= 5 ? clock.slice(0, 5) : clock;
}

export function BusinessWorkingHoursSettings({
  workingHours,
  openDays = null,
  loading = false,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [startTime, setStartTime] = useState(
    toTimeInputValue(workingHours?.startTime ?? DEFAULT_WORKING_HOURS.startTime),
  );
  const [endTime, setEndTime] = useState(
    toTimeInputValue(workingHours?.endTime ?? DEFAULT_WORKING_HOURS.endTime),
  );
  const [days, setDays] = useState<number[]>(openDays ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setStartTime(
      toTimeInputValue(
        workingHours?.startTime ?? DEFAULT_WORKING_HOURS.startTime,
      ),
    );
    setEndTime(
      toTimeInputValue(workingHours?.endTime ?? DEFAULT_WORKING_HOURS.endTime),
    );
  }, [workingHours?.startTime, workingHours?.endTime]);

  // Follow the saved days when they load, without an effect.
  const openDaysKey = (openDays ?? []).join(",");
  const [loadedDaysKey, setLoadedDaysKey] = useState(openDaysKey);
  if (loadedDaysKey !== openDaysKey) {
    setLoadedDaysKey(openDaysKey);
    setDays(openDaysKey ? openDaysKey.split(",").map(Number) : []);
  }

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
          workingHours: { startTime, endTime },
          ...(days.length > 0 ? { openDays: days } : {}),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: {
          workingHours?: BusinessWorkingHours | null;
          openDays?: number[] | null;
        };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save working hours.");
      }

      const next = payload.profile?.workingHours;
      const savedDays = days.length > 0 ? [...days].sort((a, b) => a - b) : openDays;
      if (next?.startTime && next.endTime) {
        onSaved?.(next, savedDays);
      } else {
        onSaved?.({ startTime, endTime }, savedDays);
      }
      setSuccess(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save working hours.",
      );
    } finally {
      setSaving(false);
    }
  }

  const preview = describeWorkingHoursWindow({ startTime, endTime });

  return (
    <SettingsSection
      title="Working hours"
      description="Set when your business operates. The calendar shows one-hour slots between these times."
      icon="schedule"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Start time
          </span>
          <input
            type="time"
            value={startTime}
            disabled={loading || saving}
            onChange={(event) => setStartTime(event.target.value)}
            className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </label>
        <label className="block">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            End time
          </span>
          <input
            type="time"
            value={endTime}
            disabled={loading || saving}
            onChange={(event) => setEndTime(event.target.value)}
            className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Open days
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEK_ORDER.map((day) => (
            <label key={day} className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 px-2.5 py-1.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                className="accent-primary"
                disabled={loading || saving}
                checked={days.includes(day)}
                onChange={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}
              />
              {WEEKDAY_NAMES[day].slice(0, 3)}
            </label>
          ))}
        </div>
        <p className="mt-1.5 font-body text-[12px] text-on-surface-variant">
          {days.length === 0
            ? "Not set yet. Until it is, Sophie asks you before answering “are you open?” emails."
            : "Sophie uses these days, your hours and your closed dates to answer “are you open?” emails."}
        </p>
      </fieldset>

      <p className="mt-3 font-body text-[13px] text-on-surface-variant">
        Calendar window: <span className="font-semibold text-on-surface">{preview}</span>
      </p>

      {error ? (
        <p className="mt-3 font-body text-[13px] text-error">{error}</p>
      ) : null}
      {success ? (
        <p className="mt-3 font-body text-[13px] text-green-700">
          Working hours saved.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="rounded-xl bg-primary px-4 py-2.5 font-body text-[14px] font-semibold text-on-primary disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save hours"}
        </button>
      </div>
    </SettingsSection>
  );
}
