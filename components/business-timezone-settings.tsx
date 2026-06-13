"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfileActions } from "@/lib/business/use-business-profile";
import {
  AU_TIMEZONES,
  DEFAULT_AU_TIMEZONE,
  type AuTimezone,
} from "@/lib/onboarding/types";
import { useState } from "react";

const SELECT_CLASS =
  "mt-2 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type Props = {
  timezone: string | null;
  loading?: boolean;
  onSaved: (timezone: AuTimezone) => void;
};

function resolveTimezone(value: string | null): AuTimezone {
  return AU_TIMEZONES.some((tz) => tz.id === value)
    ? (value as AuTimezone)
    : DEFAULT_AU_TIMEZONE;
}

export function BusinessTimezoneSettings({
  timezone,
  loading = false,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const profileActions = useBusinessProfileActions();
  const [selectedTimezone, setSelectedTimezone] = useState<AuTimezone>(() =>
    resolveTimezone(timezone),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        body: JSON.stringify({ timezone: selectedTimezone }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: { timezone?: string | null };
      };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not save timezone.");
      }

      const nextTimezone = resolveTimezone(payload.profile.timezone ?? null);
      onSaved(nextTimezone);
      profileActions?.mergeBusinessProfile({ timezone: nextTimezone });
      setNotice("Timezone saved. Dates and times now use this timezone.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save timezone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon="schedule"
      title="Timezone"
      description="Choose the timezone used for dashboard dates, booking slots, quotations, invoices, and customer messages."
    >
      {loading ? (
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading timezone…
        </p>
      ) : (
        <div className="space-y-4">
          <label className="block max-w-xl">
            <span className="font-body text-[13px] font-semibold text-on-surface">
              Business timezone
            </span>
            <select
              value={selectedTimezone}
              disabled={saving}
              onChange={(event) =>
                setSelectedTimezone(event.target.value as AuTimezone)
              }
              className={SELECT_CLASS}
            >
              {AU_TIMEZONES.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
              This setting applies to the whole business account.
            </span>
          </label>

          <div className="flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving…" : "Save timezone"}
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
