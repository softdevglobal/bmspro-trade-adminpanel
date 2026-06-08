import { DashboardShell } from "@/components/dashboard-shell";
import { AuditLogView } from "@/components/audit-log-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit log",
};

export default function AuditLogPage() {
  return (
    <DashboardShell
      title="Audit log"
      subtitle="Every action tenants take — inspections, quotations, bookings, staff, customers, services and items — with who did it and whether it came from the customer portal or the admin panel."
    >
      <AuditLogView />
    </DashboardShell>
  );
}
