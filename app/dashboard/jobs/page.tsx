import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { JobsBoard } from "@/components/jobs-board";
import { DashboardShell } from "@/components/dashboard-shell";

export default function JobsPage() {
  return (
    <DashboardShell
      title="Jobs"
      subtitle="Confirmed jobs converted from completed requests and quotations."
    >
      <BusinessOwnerGuard>
        <JobsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
