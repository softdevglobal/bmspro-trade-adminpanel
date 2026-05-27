import { DashboardShell } from "@/components/dashboard-shell";
import { TenantsTable } from "@/components/tenants-table";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tenants - BMS Pro Trade",
};

export default function TenantsPage() {
  return (
    <DashboardShell
      title="Tenants"
      subtitle="Businesses onboarded onto BMS Pro Trade. View active and suspended tenants or onboard a new business directly."
    >
      <TenantsTable />
    </DashboardShell>
  );
}
