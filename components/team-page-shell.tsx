import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";

export function TeamPageShell({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <DashboardShell title={title} subtitle={subtitle} icon={icon}>
      <BusinessOwnerGuard>{children}</BusinessOwnerGuard>
    </DashboardShell>
  );
}
