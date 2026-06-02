import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { QuotationsBoard } from "@/components/quotations-board";

export default function QuotationsPage() {
  return (
    <DashboardShell
      title="Quotations"
      subtitle="Create and manage quotes sent to customers."
      icon="request_quote"
    >
      <BusinessOwnerGuard>
        <QuotationsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
