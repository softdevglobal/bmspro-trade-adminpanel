import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { OwnerCustomMessagesBoard } from "@/components/owner-custom-messages-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom messages - BMS Pro Trade",
};

export default function OwnerCustomMessagesPage() {
  return (
    <DashboardShell
      title="Custom messages"
      subtitle="Send a text message — like seasonal greetings — to your customers."
      icon="campaign"
    >
      <BusinessOwnerGuard>
        <OwnerCustomMessagesBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
