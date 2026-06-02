import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { QuotationsBoard } from "@/components/quotations-board";

export default function QuotationsPage() {
  return (
    <DashboardShell
      title="Quotations"
      subtitle="Quotes sent to customers from completed inspection visits."
      icon="request_quote"
    >
      <BusinessOwnerGuard>
        <QuotationsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
