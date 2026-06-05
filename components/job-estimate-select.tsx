"use client";

import {
  formatJobEstimateLabel,
  JOB_ESTIMATE_SELECT_CHEVRON,
  JOB_ESTIMATE_SELECT_CLASS,
  jobEstimateOptionValues,
} from "@/lib/bookings/job-estimate";

export function JobEstimateSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (minutes: number) => void;
}) {
  const options = jobEstimateOptionValues(value);

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange(Number.parseInt(event.target.value, 10))
      }
      className={JOB_ESTIMATE_SELECT_CLASS}
      style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }}
    >
      {options.map((mins) => (
        <option key={mins} value={mins}>
          {formatJobEstimateLabel(mins)}
        </option>
      ))}
    </select>
  );
}
