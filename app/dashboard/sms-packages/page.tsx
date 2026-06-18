import { DashboardShell } from "@/components/dashboard-shell";
import { SmsPackagesBoard } from "@/components/sms-packages-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Packages - BMS Pro Trade",
};

export default function SmsPackagesPage() {
  return (
    <DashboardShell
      title="SMS Packages"
      subtitle="Manage SMS add-on packages for workshops."
      icon="sms"
      hidePageHeader
    >
      <SuperAdminGuard>
        <SmsPackagesBoard />
      </SuperAdminGuard>
    </DashboardShell>
  );
}
