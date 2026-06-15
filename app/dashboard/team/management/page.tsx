import { TeamPageShell } from "@/components/team-page-shell";
import { TeamStaffForm } from "@/components/team-staff-form";

export default function TeamManagementPage() {
  return (
    <TeamPageShell
      title="Team management"
      subtitle="Add, edit, suspend or remove team members for your business."
      icon="manage_accounts"
    >
      <TeamStaffForm />
    </TeamPageShell>
  );
}
