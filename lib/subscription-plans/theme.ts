export type PlanThemeId =
  | "blue"
  | "slate"
  | "purple"
  | "teal"
  | "orange"
  | "cyan";

export type PlanThemeOption = {
  id: PlanThemeId;
  label: string;
  /** Tailwind gradient classes for card header */
  gradient: string;
  /** Light tinted background for card body */
  surface: string;
  ring: string;
};

export const PLAN_THEME_OPTIONS: PlanThemeOption[] = [
  {
    id: "blue",
    label: "Blue",
    gradient: "from-cyan-400 via-blue-600 to-violet-700",
    surface: "bg-sky-50",
    ring: "ring-blue-500",
  },
  {
    id: "slate",
    label: "Slate",
    gradient: "from-slate-600 via-slate-800 to-slate-950",
    surface: "bg-slate-50",
    ring: "ring-slate-600",
  },
  {
    id: "purple",
    label: "Purple",
    gradient: "from-violet-500 via-purple-600 to-indigo-900",
    surface: "bg-violet-50",
    ring: "ring-purple-500",
  },
  {
    id: "teal",
    label: "Teal",
    gradient: "from-emerald-400 via-teal-500 to-cyan-700",
    surface: "bg-teal-50",
    ring: "ring-teal-500",
  },
  {
    id: "orange",
    label: "Orange",
    gradient: "from-amber-400 via-orange-500 to-rose-600",
    surface: "bg-orange-50",
    ring: "ring-orange-500",
  },
  {
    id: "cyan",
    label: "Cyan",
    gradient: "from-sky-400 via-cyan-500 to-blue-600",
    surface: "bg-cyan-50",
    ring: "ring-cyan-500",
  },
];

export function normalizePlanThemeId(value: unknown): PlanThemeId {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (id === "primary") return "blue";
  if (id === "secondary") return "slate";
  if (PLAN_THEME_OPTIONS.some((opt) => opt.id === id)) {
    return id as PlanThemeId;
  }
  return "blue";
}

export function planThemeGradient(value: unknown): string {
  const id = normalizePlanThemeId(value);
  return (
    PLAN_THEME_OPTIONS.find((opt) => opt.id === id)?.gradient ??
    PLAN_THEME_OPTIONS[0].gradient
  );
}

export function planThemeSurface(value: unknown): string {
  const id = normalizePlanThemeId(value);
  return (
    PLAN_THEME_OPTIONS.find((opt) => opt.id === id)?.surface ??
    PLAN_THEME_OPTIONS[0].surface
  );
}

export function planThemeRing(value: unknown): string {
  const id = normalizePlanThemeId(value);
  return (
    PLAN_THEME_OPTIONS.find((opt) => opt.id === id)?.ring ??
    PLAN_THEME_OPTIONS[0].ring
  );
}

export function formatLimitLabel(
  value: number,
  singular: string,
  plural?: string,
): string {
  const pluralLabel = plural ?? `${singular}s`;
  if (value < 0) return `Unlimited ${pluralLabel}`;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${pluralLabel}`;
}

export function formatRenewalLabel(cycle: "weekly" | "monthly", days: number): string {
  const unit = cycle === "monthly" ? "Monthly" : "Weekly";
  return `${unit} • ${days}-day renewal`;
}
