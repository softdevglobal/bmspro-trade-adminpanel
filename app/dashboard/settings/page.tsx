import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { BusinessSettingsPanel } from "@/components/business-settings-panel";
import { DashboardShell } from "@/components/dashboard-shell";

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      subtitle="Booking link, business profile, branding, tax, quotation defaults, and account security."
    >
      <BusinessOwnerGuard>
        <BusinessSettingsPanel />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
