"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function InvoicesBoard() {
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation");

  return (
    <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
      <span className="material-symbols-outlined text-[40px] text-outline-variant">
        receipt_long
      </span>
      <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
        {quotationId ? "Invoice coming soon" : "No invoices yet"}
      </p>
      <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
        {quotationId
          ? "Invoicing from quotations is on the way. For now, return to the quotation or schedule the job first."
          : "Create invoices from completed jobs or quotations and send them to your customers."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {quotationId ? (
          <Link
            href="/dashboard/quotations"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[20px]">
              request_quote
            </span>
            Back to quotations
          </Link>
        ) : (
          <Link
            href="/dashboard/inspection-visits"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[20px]">
              event_available
            </span>
            Inspection visits
          </Link>
        )}
      </div>
    </div>
  );
}
