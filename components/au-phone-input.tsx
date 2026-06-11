"use client";

import {
  AU_COUNTRY_CODE,
  toAuLocalPhoneDigits,
} from "@/lib/phone/au-phone";

const SIZE_STYLES = {
  sm: {
    wrapper: "h-10",
    prefix: "px-2.5 text-[12px]",
    input: "px-3 text-[14px]",
  },
  md: {
    wrapper: "h-11",
    prefix: "px-3 text-[13px]",
    input: "px-3 text-body-md",
  },
  lg: {
    wrapper: "min-h-12",
    prefix: "px-3 text-[13px]",
    input: "px-3 py-3 text-[16px] sm:py-2.5 sm:text-[14px]",
  },
} as const;

export type AuPhoneInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: string;
  /** Left padding class when the field sits beside a leading icon (e.g. pl-12). */
  leadingIconPadding?: string;
  size?: keyof typeof SIZE_STYLES;
  className?: string;
  inputClassName?: string;
};

export function AuPhoneInput({
  id,
  value,
  onChange,
  placeholder = "400 000 000",
  disabled = false,
  readOnly = false,
  required = false,
  autoComplete = "tel",
  leadingIconPadding = "",
  size = "md",
  className = "",
  inputClassName = "",
}: AuPhoneInputProps) {
  const styles = SIZE_STYLES[size];
  const localValue = toAuLocalPhoneDigits(value);

  return (
    <div
      className={`flex w-full min-w-0 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${styles.wrapper} ${leadingIconPadding} ${className}`}
    >
      <span
        className={`flex shrink-0 items-center border-r border-outline-variant bg-surface-container font-body font-semibold text-on-surface-variant ${styles.prefix}`}
        aria-hidden
      >
        {AU_COUNTRY_CODE}
      </span>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        value={localValue}
        onChange={(event) => onChange(toAuLocalPhoneDigits(event.target.value))}
        placeholder={placeholder}
        className={`min-w-0 flex-1 bg-transparent font-body text-on-surface placeholder:text-outline focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-on-surface-variant ${styles.input} ${inputClassName}`}
      />
    </div>
  );
}
