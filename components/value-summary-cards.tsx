/**
 * Money summary tiles shown above the Quotations and Invoices boards. Same
 * look as the other dashboard stat tiles (Team attendance, Leave requests).
 */
export type ValueSummaryItem = {
  label: string;
  valueAud: number;
  /** e.g. "3 quotes". */
  detail: string;
  icon: string;
  tone: "amber" | "green" | "rose" | "primary";
};

const TONE_CLASS: Record<ValueSummaryItem["tone"], string> = {
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  primary: "bg-primary/10 text-primary",
};

function formatAud(value: number): string {
  return `Aus $${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ValueSummaryCards({ items }: { items: ValueSummaryItem[] }) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-3"
        >
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_CLASS[item.tone]}`}
          >
            <span className="material-symbols-outlined text-[20px]">
              {item.icon}
            </span>
          </span>
          <div className="min-w-0">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              {item.label}
            </p>
            <p className="mt-0.5 truncate font-display text-[1.35rem] font-semibold text-on-surface">
              <span className="font-numeric">{formatAud(item.valueAud)}</span>
            </p>
            <p className="font-body text-[12px] text-on-surface-variant">
              {item.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
