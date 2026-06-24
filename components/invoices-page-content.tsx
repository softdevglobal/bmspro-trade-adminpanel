"use client";

import { CreateInvoiceFromQuotation } from "@/components/create-invoice-from-quotation";
import { InvoicesBoard } from "@/components/invoices-board";
import { useDashboardPageMetaOverride } from "@/lib/dashboard/page-meta-context";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

function InvoicesPageInner() {
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation")?.trim() ?? "";
  const draftInvoiceId = searchParams.get("invoice")?.trim() ?? "";
  const isNew = searchParams.get("new") === "1";
  const isEditor = Boolean(quotationId || draftInvoiceId || isNew);

  const editorMeta = useMemo(
    () =>
      isEditor
        ? {
            title: "Invoices",
            hidePageHeader: true as const,
            fullBleed: true as const,
          }
        : null,
    [isEditor],
  );
  useDashboardPageMetaOverride(editorMeta);

  if (isEditor) {
    return (
      <CreateInvoiceFromQuotation
        quotationId={quotationId}
        draftInvoiceId={draftInvoiceId}
        direct={isNew && !quotationId && !draftInvoiceId}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InvoicesBoard />
    </div>
  );
}

export function InvoicesPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[240px] items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
            progress_activity
          </span>
        </div>
      }
    >
      <InvoicesPageInner />
    </Suspense>
  );
}
