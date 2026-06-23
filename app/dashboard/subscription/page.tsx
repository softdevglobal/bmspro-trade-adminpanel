import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { OwnerSubscriptionBoard } from "@/components/owner-subscription-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription - BMS Pro Trade",
};

export default function OwnerSubscriptionPage() {
  return (
    <DashboardShell
      title="Subscription"
      subtitle="View your plan, staff limits, and upgrade or downgrade when you need to."
      icon="workspace_premium"
    >
      <BusinessOwnerGuard>
        <OwnerSubscriptionBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
