import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CalendarBoard } from "@/components/calendar-board";
import { DashboardShell } from "@/components/dashboard-shell";

export default function CalendarPage() {
  return (
    <DashboardShell
      title="Calendar"
      subtitle="View requests and bookings by day, week or month."
      icon="calendar_month"
    >
      <BusinessOwnerGuard>
        <CalendarBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
