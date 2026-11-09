/**
 * Money tiles above the Quotations and Invoices boards. Each tile is a
 * filter: click to show only its records, click again to show everything.
 * A bar shows each tile's share of the combined total.
 */
export type ValueSummaryItem = {
  label: string;
  valueAud: number;
  count: number;
  /** Singular noun for the count, e.g. "quote" → "3 quotes". */
  countNoun: string;
  icon: string;
  tone: "amber" | "green" | "rose";
  /** True while the board is filtered to this tile's records. */
  selected: boolean;
  onClick: () => void;
};

const TONES: Record<
  ValueSummaryItem["tone"],
  {
    idle: string;
    active: string;
    chip: string;
    accentText: string;
    bar: string;
    track: string;
    watermark: string;
  }
> = {
  amber: {
    idle: "border-amber-200 bg-amber-50/70 hover:border-amber-300 hover:bg-amber-50",
    active: "border-amber-500 bg-amber-500 shadow-lg shadow-amber-500/25",
    chip: "bg-white text-amber-600",
    accentText: "text-amber-600",
    bar: "bg-amber-500",
    track: "bg-amber-500/15",
    watermark: "text-amber-500/10",
  },
  green: {
    idle: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 hover:bg-emerald-50",
    active: "border-emerald-600 bg-emerald-600 shadow-lg shadow-emerald-600/25",
    chip: "bg-white text-emerald-600",
    accentText: "text-emerald-600",
    bar: "bg-emerald-500",
    track: "bg-emerald-500/15",
    watermark: "text-emerald-500/10",
  },
  rose: {
    idle: "border-rose-200 bg-rose-50/70 hover:border-rose-300 hover:bg-rose-50",
    active: "border-rose-600 bg-rose-600 shadow-lg shadow-rose-600/25",
    chip: "bg-white text-rose-600",
    accentText: "text-rose-600",
    bar: "bg-rose-500",
    track: "bg-rose-500/15",
    watermark: "text-rose-500/10",
  },
};

function formatAud(value: number): string {
  return `Aus $${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ValueSummaryCards({ items }: { items: ValueSummaryItem[] }) {
  const total = items.reduce((sum, item) => sum + item.valueAud, 0);

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const tone = TONES[item.tone];
        const share = total > 0 ? item.valueAud / total : 0;
        const percent = Math.round(share * 100);
        const selected = item.selected;
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            aria-pressed={selected}
            title={selected ? "Show all" : `Show only these ${item.countNoun}s`}
            className={`group relative overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              selected ? tone.active : tone.idle
            }`}
          >
            {/* Large faded watermark icon. */}
            <span
              aria-hidden
              className={`material-symbols-outlined pointer-events-none absolute -bottom-5 -right-3 text-[96px] leading-none transition-transform duration-300 group-hover:scale-110 ${
                selected ? "text-white/15" : tone.watermark
              }`}
            >
              {item.icon}
            </span>

            <div className="relative flex items-center justify-between">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  selected ? "bg-white/20 text-white" : tone.chip
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {selected ? "check" : item.icon}
                </span>
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-body text-[11px] font-extrabold ${
                  selected ? "bg-white/20 text-white" : tone.chip
                }`}
              >
                {item.count} {item.countNoun}
                {item.count === 1 ? "" : "s"}
              </span>
            </div>

            <p
              className={`relative mt-3 font-body text-[11px] font-extrabold uppercase tracking-wider ${
                selected ? "text-white/85" : "text-on-surface-variant"
              }`}
            >
              {item.label}
            </p>
            <p
              className={`relative mt-0.5 truncate font-display text-[1.6rem] font-bold leading-tight ${
                selected ? "text-white" : "text-on-surface"
              }`}
            >
              <span className="font-numeric">{formatAud(item.valueAud)}</span>
            </p>

            <div
              className={`relative mt-3 h-1.5 overflow-hidden rounded-full ${
                selected ? "bg-white/25" : tone.track
              }`}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                  selected ? "bg-white" : tone.bar
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p
              className={`relative mt-1.5 font-body text-[11px] font-semibold ${
                selected ? "text-white/85" : tone.accentText
              }`}
            >
              {selected ? "Showing only these · click to show all" : `${percent}% of total · click to filter`}
            </p>
          </button>
        );
      })}
    </div>
  );
}
