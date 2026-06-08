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
      subtitle="Super admins see all tenants. Business owners see their activity — Auth shows owner and customer sign-ins, Staff shows staff sign-ins, plus inspections, bookings, and more."
    >
      <AuditLogView />
    </DashboardShell>
  );
}
