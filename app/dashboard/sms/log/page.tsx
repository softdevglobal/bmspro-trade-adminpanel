import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { SmsLogBoard } from "@/components/sms-log-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Log - BMS Pro Trade",
};

export default function OwnerSmsLogPage() {
  return (
    <DashboardShell
      title="SMS log"
      subtitle="Outbound messages sent from your workshop."
      icon="history"
    >
      <BusinessOwnerGuard>
        <SmsLogBoard variant="tenant" />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
