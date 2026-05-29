import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { InspectionVisitsBoard } from "@/components/inspection-visits-board";

export default function InspectionVisitsPage() {
  return (
    <DashboardShell
      title="Inspection visits"
      subtitle="Review customer requests, schedule visits and assign an inspector."
    >
      <BusinessOwnerGuard>
        <InspectionVisitsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
