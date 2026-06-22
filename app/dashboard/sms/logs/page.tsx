import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Logs - BMS Pro Trade",
};

export default function OwnerSmsLogsPage() {
  return (
    <DashboardShell
      title="SMS logs"
      subtitle="A history of the SMS messages sent from your business."
      icon="history"
    >
      <BusinessOwnerGuard>
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-16 text-center">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">
            forum
          </span>
          <h3 className="font-display text-[17px] font-bold text-on-surface">
            SMS logs are coming soon
          </h3>
          <p className="max-w-sm font-body text-[13px] text-on-surface-variant">
            Delivery history for your customer SMS messages will appear here.
          </p>
        </div>
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
