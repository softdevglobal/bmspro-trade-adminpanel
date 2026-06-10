import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { RequestsBoard } from "@/components/requests-board";

export default function RequestsPage() {
  return (
    <DashboardShell
      title="Requests"
      subtitle="Review customer requests, schedule visits and assign an inspector."
    >
      <BusinessOwnerGuard>
        <RequestsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
