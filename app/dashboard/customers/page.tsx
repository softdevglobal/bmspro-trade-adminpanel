import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CustomersBoard } from "@/components/customers-board";
import { DashboardShell } from "@/components/dashboard-shell";

export default function CustomersPage() {
  return (
    <DashboardShell
      title="Customers"
      subtitle="People who have requested work through your booking page."
      icon="group"
    >
      <BusinessOwnerGuard>
        <CustomersBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
