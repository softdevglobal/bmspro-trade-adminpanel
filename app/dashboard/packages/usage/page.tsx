import { AdminPackagesUsageBoard } from "@/components/admin-packages-usage-board";
import { DashboardShell } from "@/components/dashboard-shell";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Package Usage - BMS Pro Trade",
};

export default function AdminPackagesUsagePage() {
  return (
    <DashboardShell
      title="Package usage"
      subtitle="Tenant subscription assignments and Stripe purchase history."
      icon="assignment"
    >
      <SuperAdminGuard>
        <AdminPackagesUsageBoard />
      </SuperAdminGuard>
    </DashboardShell>
  );
}
