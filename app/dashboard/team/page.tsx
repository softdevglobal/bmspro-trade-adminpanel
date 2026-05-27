import { DashboardShell } from "@/components/dashboard-shell";
import { TeamStaffForm } from "@/components/team-staff-form";

export default function TeamPage() {
  return (
    <DashboardShell
      title="Team"
      subtitle="Add staff members who work inside your business."
    >
      <TeamStaffForm />
    </DashboardShell>
  );
}
