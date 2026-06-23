import { AdminSmsUsageBoard } from "@/components/admin-sms-usage-board";
import { DashboardShell } from "@/components/dashboard-shell";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Usage - BMS Pro Trade",
};

export default function AdminSmsUsagePage() {
  return (
    <DashboardShell
      title="SMS usage"
      subtitle="Tenant SMS assignments and Stripe purchase history."
      icon="assignment"
    >
      <SuperAdminGuard>
        <AdminSmsUsageBoard />
      </SuperAdminGuard>
    </DashboardShell>
  );
}
