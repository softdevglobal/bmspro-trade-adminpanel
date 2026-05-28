import { DashboardShell } from "@/components/dashboard-shell";
import { TeamStaffForm } from "@/components/team-staff-form";

export default function TeamPage() {
  return (
    <DashboardShell
      title="Team"
      subtitle="View staff members and setup new users for your business."
    >
      <TeamStaffForm />
    </DashboardShell>
  );
}
