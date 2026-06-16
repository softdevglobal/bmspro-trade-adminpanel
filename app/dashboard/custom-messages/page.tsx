import { CustomMessagesBoard } from "@/components/custom-messages-board";
import { DashboardShell } from "@/components/dashboard-shell";

export default function CustomMessagesPage() {
  return (
    <DashboardShell
      title="Custom messages"
      subtitle="Send a platform-wide announcement to business owners and staff."
      icon="campaign"
    >
      <CustomMessagesBoard />
    </DashboardShell>
  );
}
