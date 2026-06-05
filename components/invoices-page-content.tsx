"use client";

import { CreateInvoiceFromQuotation } from "@/components/create-invoice-from-quotation";
import { DashboardShell } from "@/components/dashboard-shell";
import { InvoicesBoard } from "@/components/invoices-board";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function InvoicesPageInner() {
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation")?.trim() ?? "";

  if (quotationId) {
    return (
      <DashboardShell title="Invoices" hidePageHeader fullBleed>
        <CreateInvoiceFromQuotation quotationId={quotationId} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Invoices"
      subtitle="Create and send invoices to your customers."
      icon="receipt_long"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <InvoicesBoard />
      </div>
    </DashboardShell>
  );
}

export function InvoicesPageContent() {
  return (
    <Suspense fallback={null}>
      <InvoicesPageInner />
    </Suspense>
  );
}
