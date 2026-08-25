"use client";

import {
  SCHEDULE_SELECT_CHEVRON,
  SCHEDULE_SELECT_CLASS,
} from "@/components/calendar-visit-time-range";
import { MonthCalendarField } from "@/components/month-calendar-field";
import {
  emptyRecurrenceDraft,
  expandRecurrenceDates,
  formatRecurrenceSummary,
  MAX_RECURRENCE_OCCURRENCES,
  parseYmd,
  type JobRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceUnit,
  type SeriesUpdateMode,
} from "@/lib/bookings/recurrence";
import { WEEK_DAY_IDS, type WeekDayId } from "@/lib/team/staff-availability";
import { useId } from "react";

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

const RADIO_CLASS = "h-4 w-4 shrink-0 accent-primary";

const OPTION_ROW_CLASS =
  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 transition-colors";

const WEEKDAY_LABELS: Record<WeekDayId, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

const MAX_INTERVAL = 24;
const INTERVAL_OPTIONS = Array.from(
  { length: MAX_INTERVAL },
  (_, index) => index + 1,
);
const VISIT_COUNT_OPTIONS = Array.from(
  { length: MAX_RECURRENCE_OCCURRENCES },
  (_, index) => index + 1,
);

function withEnd(rule: JobRecurrenceRule, end: RecurrenceEnd): JobRecurrenceRule {
  return { ...rule, end };
}

function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function ScheduleTypeCard({
  selected,
  disabled,
  invalid,
  icon,
  title,
  hint,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  invalid?: boolean;
  icon: string;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-[4.5rem] items-start gap-3 rounded-xl border p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : invalid
            ? "border-error/60 bg-surface-container-lowest hover:border-error"
            : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          selected ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[14px] font-semibold text-on-surface">
          {title}
        </span>
        <span className="mt-0.5 block font-body text-[12px] leading-snug text-on-surface-variant">
          {hint}
        </span>
      </span>
      <span
        className={`material-symbols-outlined text-[20px] ${
          selected ? "text-primary" : "text-outline-variant"
        }`}
      >
        {selected ? "radio_button_checked" : "radio_button_unchecked"}
      </span>
    </button>
  );
}

export function JobRecurrenceBuilder({
  enabled,
  rule,
  disabled,
  invalid,
  startDate,
  startTime,
  endTime,
  requiredSkill,
  skillOptions,
  onEnabledChange,
  onChange,
  onRequiredSkillChange,
}: {
  /** `null` means the user has not chosen yet. */
  enabled: boolean | null;
  rule: JobRecurrenceRule;
  disabled?: boolean;
  invalid?: boolean;
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
  const minEndDate = rule.startDate || startDate;
  const monthDay = rule.monthDay ?? parseYmd(rule.startDate)?.day ?? 1;

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
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL_CLASS}>How often</span>
        {enabled === null ? (
          <span
            className={`font-body text-[11px] font-semibold ${
              invalid ? "text-error" : "text-on-surface-variant"
            }`}
          >
            Required
          </span>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Visit schedule type"
        aria-required
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <ScheduleTypeCard
          selected={enabled === false}
          disabled={disabled}
          invalid={invalid && enabled === null}
          icon="event"
          title="One visit"
          hint="Schedule this job once."
          onSelect={() => onEnabledChange(false)}
        />
        <ScheduleTypeCard
          selected={enabled === true}
          disabled={disabled}
          invalid={invalid && enabled === null}
          icon="event_repeat"
          title="Repeating"
          hint="Every few days, weeks, or months."
          onSelect={() => {
            if (!enabled) enable();
          }}
        />
      </div>

      {enabled === null ? (
        <p
          className={`font-body text-[12px] ${
            invalid ? "text-error" : "text-on-surface-variant"
          }`}
        >
          Choose one visit or repeating to continue.
        </p>
      ) : null}

      {enabled ? (
        <div className="space-y-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL_CLASS}>Repeat every</span>
              <select
                value={rule.interval}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...rule, interval: Number(event.target.value) })
                }
                className={`${SCHEDULE_SELECT_CLASS} mt-1`}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
              >
                {INTERVAL_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL_CLASS}>Period</span>
              <select
                value={rule.unit}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    unit: event.target.value as RecurrenceUnit,
                  })
                }
                className={`${SCHEDULE_SELECT_CLASS} mt-1`}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
              >
                <option value="day">
                  {rule.interval === 1 ? "Day" : "Days"}
                </option>
                <option value="week">
                  {rule.interval === 1 ? "Week" : "Weeks"}
                </option>
                <option value="month">
                  {rule.interval === 1 ? "Month" : "Months"}
                </option>
              </select>
            </label>
          </div>

          {rule.unit === "week" ? (
            <div>
              <span className={LABEL_CLASS}>Repeat on</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEK_DAY_IDS.map((day) => {
                  const checked = rule.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={checked}
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
                      className={`h-10 min-w-[3rem] rounded-xl border px-3 font-body text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        checked
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant hover:border-primary/40"
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
            <label className="block sm:max-w-[16rem]">
              <span className={LABEL_CLASS}>Day of month</span>
              <select
                value={monthDay}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...rule, monthDay: Number(event.target.value) })
                }
                className={`${SCHEDULE_SELECT_CLASS} mt-1`}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
              >
                {MONTH_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {ordinal(day)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
                Shorter months use their last day.
              </span>
            </label>
          ) : null}

          <div>
            <span className={LABEL_CLASS}>Ends</span>
            <div className="mt-2 grid gap-2">
              <div
                className={`${OPTION_ROW_CLASS} ${
                  rule.end.type === "never"
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant/60 bg-surface-container-lowest"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name={endGroupName}
                    className={RADIO_CLASS}
                    checked={rule.end.type === "never"}
                    disabled={disabled}
                    onChange={() => onChange(withEnd(rule, { type: "never" }))}
                  />
                  <span className="font-body text-[13px] text-on-surface">
                    Never
                  </span>
                </label>
              </div>

              <div
                className={`${OPTION_ROW_CLASS} ${
                  rule.end.type === "on_date"
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant/60 bg-surface-container-lowest"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name={endGroupName}
                    className={RADIO_CLASS}
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
                  <span className="font-body text-[13px] text-on-surface">
                    On date
                  </span>
                </label>
                <div className="ml-auto w-full sm:w-[12rem]">
                  <MonthCalendarField
                    size="comfortable"
                    placeholder="Pick a date"
                    disabled={disabled}
                    minDate={minEndDate}
                    selectedIso={
                      rule.end.type === "on_date" ? rule.end.date : ""
                    }
                    onSelect={(iso) =>
                      onChange(withEnd(rule, { type: "on_date", date: iso }))
                    }
                  />
                </div>
              </div>

              <div
                className={`${OPTION_ROW_CLASS} ${
                  rule.end.type === "after_count"
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant/60 bg-surface-container-lowest"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name={endGroupName}
                    className={RADIO_CLASS}
                    checked={rule.end.type === "after_count"}
                    disabled={disabled}
                    onChange={() =>
                      onChange(withEnd(rule, { type: "after_count", count: 12 }))
                    }
                  />
                  <span className="font-body text-[13px] text-on-surface">
                    After
                  </span>
                </label>
                <span className="ml-auto flex items-center gap-2">
                  <select
                    aria-label="Number of visits"
                    disabled={disabled}
                    value={rule.end.type === "after_count" ? rule.end.count : 12}
                    onChange={(event) =>
                      onChange(
                        withEnd(rule, {
                          type: "after_count",
                          count: Number(event.target.value),
                        }),
                      )
                    }
                    className={`${SCHEDULE_SELECT_CLASS} w-[5.5rem]`}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                  >
                    {VISIT_COUNT_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <span className="font-body text-[13px] text-on-surface-variant">
                    visits
                  </span>
                </span>
              </div>
            </div>
          </div>

          {skillOptions && skillOptions.length > 0 && onRequiredSkillChange ? (
            <label className="block">
              <span className={LABEL_CLASS}>Staff requirement</span>
              <select
                value={requiredSkill ?? ""}
                disabled={disabled}
                onChange={(event) => onRequiredSkillChange(event.target.value)}
                className={`${SCHEDULE_SELECT_CLASS} mt-1`}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
              >
                <option value="">Any team member</option>
                {skillOptions.map((skill) => (
                  <option key={skill} value={skill}>
                    {skill}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
                Used to match this visit to a staff capability profile.
              </span>
            </label>
          ) : null}

          <p className="flex items-start gap-2 rounded-xl bg-primary/5 px-3 py-2.5 font-body text-[12px] text-on-surface">
            <span className="material-symbols-outlined mt-px text-[16px] text-primary">
              event_repeat
            </span>
            <span>
              {formatRecurrenceSummary(rule)}
              {previewCount > 0
                ? ` · ${previewCount} visit${previewCount === 1 ? "" : "s"} on this job (max ${MAX_RECURRENCE_OCCURRENCES}).`
                : null}
            </span>
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
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              value === option.id
                ? "border-primary bg-surface-container-lowest ring-1 ring-primary/20"
                : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name={groupName}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              className={`${RADIO_CLASS} mt-0.5`}
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
