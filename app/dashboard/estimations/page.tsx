import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { EstimationsBoard } from "@/components/estimations-board";

export default function EstimationsPage() {
  return (
    <DashboardShell
      title="Estimations"
      subtitle="Quick job estimates before you send a formal quotation."
      icon="calculate"
    >
      <BusinessOwnerGuard>
        <EstimationsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
