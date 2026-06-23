import { DashboardShell } from "@/components/dashboard-shell";
import { SmsLogBoard } from "@/components/sms-log-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Log - BMS Pro Trade",
};

export default function AdminSmsLogPage() {
  return (
    <DashboardShell
      title="SMS log"
      subtitle="Outbound SMS history across all workshops."
      icon="history"
    >
      <SuperAdminGuard>
        <SmsLogBoard variant="admin" />
      </SuperAdminGuard>
    </DashboardShell>
  );
}
