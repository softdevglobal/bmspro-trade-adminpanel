import type { TenantDetail } from "@/lib/onboarding/tenant-display";

export type SuperAdminKpi = {
  key: string;
  label: string;
  value: string;
  icon: string;
  trend: string;
  accent: "blue" | "amber" | "emerald" | "violet";
};

export type SuperAdminOverview = {
  kpis: SuperAdminKpi[];
  focusMessage: string | null;
  recentTenants: TenantDetail[];
};

export function computeSuperAdminOverview(input: {
  tenants: TenantDetail[];
  templateCount: number;
}): SuperAdminOverview {
  const { tenants, templateCount } = input;
  const activeCount = tenants.filter((tenant) => tenant.status === "active").length;
  const pendingCount = tenants.filter(
    (tenant) => tenant.status === "pending_review",
  ).length;
  const suspendedCount = tenants.filter(
    (tenant) => tenant.status === "suspended",
  ).length;
  const selfSignupCount = tenants.filter(
    (tenant) => tenant.source === "self_signup",
  ).length;

  const kpis: SuperAdminKpi[] = [
    {
      key: "tenants",
      label: "Total tenants",
      value: String(tenants.length),
      icon: "domain",
      accent: "blue",
      trend:
        activeCount > 0
          ? `${activeCount} active`
          : tenants.length > 0
            ? "No active tenants yet"
            : "Onboard your first business",
    },
    {
      key: "pending",
      label: "Pending review",
      value: String(pendingCount),
      icon: "hourglass_top",
      accent: "amber",
      trend:
        pendingCount > 0
          ? "Needs your attention"
          : "All caught up",
    },
    {
      key: "templates",
      label: "Service templates",
      value: String(templateCount),
      icon: "settings_suggest",
      accent: "violet",
      trend:
        templateCount > 0
          ? "Global catalog ready"
          : "Publish your first template",
    },
    {
      key: "signups",
      label: "Self sign-ups",
      value: String(selfSignupCount),
      icon: "person_add",
      accent: "emerald",
      trend:
        suspendedCount > 0
          ? `${suspendedCount} suspended`
          : selfSignupCount > 0
            ? "From booking engine"
            : "No self sign-ups yet",
    },
  ];

  let focusMessage: string | null = null;
  if (pendingCount > 0) {
    focusMessage = `${pendingCount} tenant${pendingCount === 1 ? "" : "s"} waiting for review.`;
  } else if (tenants.length === 0) {
    focusMessage = "Welcome to the platform console. Onboard your first trade business to get started.";
  } else if (templateCount === 0) {
    focusMessage = "Add service templates so new tenants can launch faster.";
  } else {
    focusMessage = "Monitor tenants, templates, and onboarding from one place.";
  }

  const recentTenants = tenants
    .slice()
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 6);

  return { kpis, focusMessage, recentTenants };
}
