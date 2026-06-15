import { TeamAttendanceSection } from "@/components/team-attendance-section";
import { TeamPageShell } from "@/components/team-page-shell";

export default function TeamAttendancePage() {
  return (
    <TeamPageShell
      title="Attendance"
      subtitle="Review staff clock-in and clock-out times, with breaks deducted."
      icon="schedule"
    >
      <TeamAttendanceSection />
    </TeamPageShell>
  );
}
