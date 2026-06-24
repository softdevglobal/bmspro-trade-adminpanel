import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { BusinessSettingsPanel } from "@/components/business-settings-panel";

export default function SettingsPage() {
  return (
    <BusinessOwnerGuard>
      <BusinessSettingsPanel />
    </BusinessOwnerGuard>
  );
}
