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
        <div className="flex min-h-0 flex-1 flex-col">
          <QuotationsBoard />
        </div>
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
