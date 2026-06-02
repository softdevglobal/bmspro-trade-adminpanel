import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { BookingsBoard } from "@/components/bookings-board";
import { DashboardShell } from "@/components/dashboard-shell";

export default function BookingsPage() {
  return (
    <DashboardShell
      title="Bookings"
      subtitle="Confirmed jobs converted from completed inspection visits and quotations."
    >
      <BusinessOwnerGuard>
        <BookingsBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
