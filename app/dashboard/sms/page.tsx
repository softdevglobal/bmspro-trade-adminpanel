import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { OwnerSmsBoard } from "@/components/owner-sms-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Credits - BMS Pro Trade",
};

export default function OwnerSmsPage() {
  return (
    <DashboardShell
      title="SMS Credits"
      subtitle="View your remaining SMS balance and top up when you need more messages."
      icon="sms"
    >
      <BusinessOwnerGuard>
        <OwnerSmsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
