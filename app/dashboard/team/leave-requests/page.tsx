import { LeaveRequestsBoard } from "@/components/leave-requests-board";
import { TeamPageShell } from "@/components/team-page-shell";

export default function TeamLeaveRequestsPage() {
  return (
    <TeamPageShell
      title="Leave requests"
      subtitle="Review and approve staff time off. Approved days block new assignments."
      icon="beach_access"
    >
      <LeaveRequestsBoard />
    </TeamPageShell>
  );
}
