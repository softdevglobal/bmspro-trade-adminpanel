import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CalendarBoard } from "@/components/calendar-board";

export default function CalendarPage() {
  return (
    <BusinessOwnerGuard>
      <CalendarBoard />
    </BusinessOwnerGuard>
  );
}
