import { DashboardShell } from "@/components/dashboard-shell";
import { AuditLogView } from "@/components/audit-log-view";

export default function AuditLogPage() {
  return (
    <DashboardShell
      title="Audit logs"
      subtitle="Review sign-ins, inspections, bookings, and other activity for your business."
    >
      <AuditLogView />
    </DashboardShell>
  );
}
