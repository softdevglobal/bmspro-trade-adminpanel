"use client";

import {
  emptyRecurrenceDraft,
  expandRecurrenceDates,
  formatRecurrenceSummary,
  MAX_RECURRENCE_OCCURRENCES,
  type JobRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceUnit,
  type SeriesUpdateMode,
} from "@/lib/bookings/recurrence";
import { WEEK_DAY_IDS, type WeekDayId } from "@/lib/team/staff-availability";
import { useId } from "react";

const inputClass =
  "rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60";

const WEEKDAY_LABELS: Record<WeekDayId, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function withEnd(rule: JobRecurrenceRule, end: RecurrenceEnd): JobRecurrenceRule {
  return { ...rule, end };
}

export function JobRecurrenceBuilder({
  enabled,
  rule,
  disabled,
  startDate,
  startTime,
  endTime,
  requiredSkill,
  skillOptions,
  onEnabledChange,
  onChange,
  onRequiredSkillChange,
}: {
  enabled: boolean;
  rule: JobRecurrenceRule;
  disabled?: boolean;
  startDate: string;
  startTime: string;
  endTime: string;
  requiredSkill?: string | null;
  skillOptions?: string[];
  onEnabledChange: (enabled: boolean) => void;
  onChange: (rule: JobRecurrenceRule) => void;
  onRequiredSkillChange?: (skill: string) => void;
}) {
  const previewCount = enabled ? expandRecurrenceDates(rule).length : 0;
  const endGroupName = useId();

  function enable() {
    onEnabledChange(true);
    onChange(
      emptyRecurrenceDraft(
        startDate || rule.startDate,
        startTime || rule.startTime,
        endTime || rule.endTime,
      ),
    );
  }

  return (
    <section className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Visit schedule type"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!enabled}
          disabled={disabled}
          onClick={() => onEnabledChange(false)}
          className={`flex min-h-[4.5rem] items-start gap-3 rounded-xl border p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
            !enabled
              ? "border-primary bg-white shadow-sm ring-1 ring-primary/20"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              !enabled ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">event</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-body text-[14px] font-semibold text-on-surface">
              One visit
            </span>
            <span className="mt-0.5 block font-body text-[12px] leading-snug text-on-surface-variant">
              Schedule this job once.
            </span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={enabled}
          disabled={disabled}
          onClick={() => {
            if (!enabled) enable();
          }}
          className={`flex min-h-[4.5rem] items-start gap-3 rounded-xl border p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
            enabled
              ? "border-primary bg-white shadow-sm ring-1 ring-primary/20"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              enabled ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">
              event_repeat
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-body text-[14px] font-semibold text-on-surface">
              Repeating
            </span>
            <span className="mt-0.5 block font-body text-[12px] leading-snug text-on-surface-variant">
              Every few days, weeks, or months.
            </span>
          </span>
        </button>
      </div>

      {enabled ? (
        <div className="space-y-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Repeat every
              </span>
              <input
                type="number"
                min={1}
                max={24}
                value={rule.interval}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    interval: Math.max(1, Number(event.target.value) || 1),
                  })
                }
                className={`${inputClass} mt-1 w-20`}
              />
            </label>
            <label className="block">
              <span className="sr-only">Repeat unit</span>
              <select
                value={rule.unit}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    unit: event.target.value as RecurrenceUnit,
                  })
                }
                className={`${inputClass} mt-1`}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          </div>

          {rule.unit === "week" ? (
            <div>
              <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                On
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEK_DAY_IDS.map((day) => {
                  const checked = rule.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const next = checked
                          ? rule.weekdays.filter((item) => item !== day)
                          : [...rule.weekdays, day];
                        onChange({
                          ...rule,
                          weekdays: next.length > 0 ? next : [day],
                        });
                      }}
                      className={`rounded-full px-2.5 py-1 font-body text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                        checked
                          ? "bg-primary text-on-primary"
                          : "border border-outline-variant/60 bg-white text-on-surface-variant"
                      }`}
                    >
                      {WEEKDAY_LABELS[day]}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {rule.unit === "month" ? (
            <p className="font-body text-[12px] text-on-surface-variant">
              Repeats on day {rule.monthDay ?? 1} of the month.
            </p>
          ) : null}

          <div>
            <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Ends
            </p>
            <div className="mt-2 grid gap-2">
              <label className="flex items-center gap-2 font-body text-[13px] text-on-surface">
                <input
                  type="radio"
                  name={endGroupName}
                  checked={rule.end.type === "never"}
                  disabled={disabled}
                  onChange={() => onChange(withEnd(rule, { type: "never" }))}
                />
                Never
              </label>
              <label className="flex flex-wrap items-center gap-2 font-body text-[13px] text-on-surface">
                <input
                  type="radio"
                  name={endGroupName}
                  checked={rule.end.type === "on_date"}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      withEnd(rule, {
                        type: "on_date",
                        date: rule.startDate || startDate,
                      }),
                    )
                  }
                />
                On date
                <input
                  type="date"
                  disabled={disabled || rule.end.type !== "on_date"}
                  value={rule.end.type === "on_date" ? rule.end.date : ""}
                  onChange={(event) =>
                    onChange(withEnd(rule, { type: "on_date", date: event.target.value }))
                  }
                  className={`${inputClass} w-auto`}
                />
              </label>
              <label className="flex flex-wrap items-center gap-2 font-body text-[13px] text-on-surface">
                <input
                  type="radio"
                  name={endGroupName}
                  checked={rule.end.type === "after_count"}
                  disabled={disabled}
                  onChange={() =>
                    onChange(withEnd(rule, { type: "after_count", count: 12 }))
                  }
                />
                After
                <input
                  type="number"
                  min={1}
                  max={MAX_RECURRENCE_OCCURRENCES}
                  disabled={disabled || rule.end.type !== "after_count"}
                  value={rule.end.type === "after_count" ? rule.end.count : 12}
                  onChange={(event) =>
                    onChange(
                      withEnd(rule, {
                        type: "after_count",
                        count: Math.min(
                          MAX_RECURRENCE_OCCURRENCES,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      }),
                    )
                  }
                  className={`${inputClass} w-20`}
                />
                visits
              </label>
            </div>
          </div>

          {skillOptions && skillOptions.length > 0 && onRequiredSkillChange ? (
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Staff requirement
              </span>
              <select
                value={requiredSkill ?? ""}
                disabled={disabled}
                onChange={(event) => onRequiredSkillChange(event.target.value)}
                className={`${inputClass} mt-1 w-full`}
              >
                <option value="">Any team member</option>
                {skillOptions.map((skill) => (
                  <option key={skill} value={skill}>
                    {skill}
                  </option>
                ))}
              </select>
              <p className="mt-1 font-body text-[11px] text-on-surface-variant">
                Used to match this visit to a staff capability profile.
              </p>
            </label>
          ) : null}

          <p className="rounded-lg bg-primary/5 px-3 py-2 font-body text-[12px] text-on-surface">
            {formatRecurrenceSummary(rule)}
            {previewCount > 0
              ? ` · ${previewCount} visit${previewCount === 1 ? "" : "s"} on this job (max ${MAX_RECURRENCE_OCCURRENCES}).`
              : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function SeriesUpdateScopePicker({
  value,
  disabled,
  onChange,
}: {
  value: SeriesUpdateMode;
  disabled?: boolean;
  onChange: (mode: SeriesUpdateMode) => void;
}) {
  const groupName = useId();
  const options: { id: SeriesUpdateMode; label: string; hint: string }[] = [
    {
      id: "this_visit",
      label: "This visit only",
      hint: "Leaves the rest of the series unchanged.",
    },
    {
      id: "this_and_future",
      label: "This and future visits",
      hint: "Applies from this date forward. Past visits stay as they are.",
    },
    {
      id: "entire_series",
      label: "Entire series",
      hint: "Updates every open visit in the repeating pattern.",
    },
  ];

  return (
    <fieldset className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <legend className="font-display text-[14px] font-semibold text-on-surface">
        Apply changes to
      </legend>
      <div className="mt-3 grid gap-2">
        {options.map((option) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              value === option.id
                ? "border-primary bg-white ring-1 ring-primary/20"
                : "border-outline-variant/60 bg-surface-container-lowest"
            }`}
          >
            <input
              type="radio"
              name={groupName}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              className="mt-1"
            />
            <span>
              <span className="block font-body text-[13px] font-semibold text-on-surface">
                {option.label}
              </span>
              <span className="mt-0.5 block font-body text-[12px] text-on-surface-variant">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
