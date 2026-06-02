import { Suspense } from "react";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { InvoicesBoard } from "@/components/invoices-board";

export default function InvoicesPage() {
  return (
    <DashboardShell
      title="Invoices"
      subtitle="Create and send invoices to your customers."
      icon="receipt_long"
    >
      <BusinessOwnerGuard>
        <Suspense fallback={null}>
          <InvoicesBoard />
        </Suspense>
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
