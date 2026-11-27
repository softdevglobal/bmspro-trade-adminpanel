export type BusinessModuleKey =
  | "requests"
  | "quotations"
  | "invoices"
  | "jobs"
  | "expenses";

export type BusinessModuleSettings = Record<BusinessModuleKey, boolean>;

/** Defaults for newly registered businesses. */
export const NEW_BUSINESS_MODULE_DEFAULTS: BusinessModuleSettings = {
  requests: true,
  quotations: false,
  invoices: false,
  jobs: false,
  expenses: false,
};

/**
 * Existing tenants without `enabledModules` keep the original modules on.
 * Expenses came later, so the owner turns it on in Settings.
 */
export const LEGACY_BUSINESS_MODULE_DEFAULTS: BusinessModuleSettings = {
  requests: true,
  quotations: true,
  invoices: true,
  jobs: true,
  expenses: false,
};

export const BUSINESS_MODULE_LABELS: Record<BusinessModuleKey, string> = {
  requests: "Site inspections",
  quotations: "Quotations",
  invoices: "Invoices",
  jobs: "Jobs",
  expenses: "Expenses",
};

export const OWNER_TOGGLEABLE_MODULES: Array<
  Exclude<BusinessModuleKey, "requests">
> = ["quotations", "invoices", "jobs", "expenses"];

export function parseBusinessModuleSettings(
  data: Record<string, unknown> | null | undefined,
): BusinessModuleSettings {
  const raw = data?.enabledModules;
  if (!raw || typeof raw !== "object") {
    return { ...LEGACY_BUSINESS_MODULE_DEFAULTS };
  }

  const modules = raw as Record<string, unknown>;
  return {
    requests: modules.requests !== false,
    quotations: Boolean(modules.quotations),
    invoices: Boolean(modules.invoices),
    jobs: Boolean(modules.jobs),
    expenses: Boolean(modules.expenses),
  };
}

export function isBusinessModuleEnabled(
  settings: BusinessModuleSettings,
  module: BusinessModuleKey,
): boolean {
  return settings[module] === true;
}

export function normalizeModuleSettingsPatch(
  raw: unknown,
): { ok: true; value: Partial<BusinessModuleSettings> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Module settings must be an object." };
  }

  const input = raw as Record<string, unknown>;
  const value: Partial<BusinessModuleSettings> = {};

  for (const key of OWNER_TOGGLEABLE_MODULES) {
    if (key in input) {
      if (typeof input[key] !== "boolean") {
        return {
          ok: false,
          error: `${BUSINESS_MODULE_LABELS[key]} must be enabled or disabled.`,
        };
      }
      value[key] = input[key];
    }
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "No valid module settings to update." };
  }

  return { ok: true, value };
}

export function mergeModuleSettings(
  current: BusinessModuleSettings,
  patch: Partial<BusinessModuleSettings>,
): BusinessModuleSettings {
  return {
    ...current,
    ...patch,
    requests: true,
  };
}
