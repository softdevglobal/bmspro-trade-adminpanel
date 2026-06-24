"use client";

import { MAX_SERVICE_AREAS } from "@/lib/onboarding/types";

type Props = {
  values: string[];
  onUpdate: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
};

export function ServiceAreasField({
  values,
  onUpdate,
  onAdd,
  onRemove,
  disabled = false,
}: Props) {
  const filled = values.filter((v) => v.trim().length >= 2).length;
  const canAdd = values.length < MAX_SERVICE_AREAS;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-fixed/30 px-3 py-2.5">
        <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[20px] text-primary">
          radar
        </span>
        <p className="font-body text-[12px] text-on-surface-variant">
          List the suburbs, towns, or regions you cover. These appear on your
          public booking page and help reception confirm whether a job address
          is inside your service area.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {values.map((value, index) => {
          const isOnlyRow = values.length === 1;
          return (
            <div key={index} className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                  location_on
                </span>
                <input
                  type="text"
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onUpdate(index, e.target.value)}
                  autoCapitalize="words"
                  spellCheck={false}
                  placeholder={
                    index === 0
                      ? "e.g. Lynbrook 3975"
                      : "Another suburb, town, or region"
                  }
                  className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-10 pr-3 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled || (isOnlyRow && !value.trim())}
                aria-label={`Remove service area ${index + 1}`}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition-colors hover:border-error/40 hover:bg-error-container/40 hover:text-error disabled:opacity-40 disabled:hover:border-outline-variant disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[20px]">
                  close
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || !canAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary-fixed/40 px-3 py-2 font-body text-[12px] font-semibold text-primary transition-colors hover:bg-primary-fixed/70 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add another area
        </button>
        <span className="font-body text-[11px] text-on-surface-variant">
          {filled} added · max {MAX_SERVICE_AREAS}
        </span>
      </div>
    </div>
  );
}
