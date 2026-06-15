import { DashboardShell } from "@/components/dashboard-shell";
import { PackagesBoard } from "@/components/packages-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packages - BMS Pro Trade",
};

export default function PackagesPage() {
  return (
    <DashboardShell
      title="Subscription Packages"
      subtitle="Manage subscription plans for workshops."
      icon="inventory_2"
      hidePageHeader
    >
      <SuperAdminGuard>
        <PackagesBoard />
      </SuperAdminGuard>
    </DashboardShell>
  );
}
