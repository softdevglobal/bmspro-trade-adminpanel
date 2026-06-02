"use client";

import {
  formatQuoteMoney,
  type QuotationDocumentData,
} from "@/lib/quotations/document";

type Props = {
  document: QuotationDocumentData;
  className?: string;
};

/**
 * HTML preview that mirrors the generated quotation PDF layout.
 */
export function QuotationDocumentPreview({ document, className = "" }: Props) {
  const { business, lineItems } = document;

  return (
    <div
      className={`mx-auto w-full max-w-[720px] overflow-hidden bg-white font-body text-[13px] leading-relaxed text-[#1e2430] shadow-[0_8px_40px_rgba(11,51,160,0.12)] ring-1 ring-[#d4d8e0] ${className}`}
    >
      {/* Brand accent bar */}
      <div className="h-1.5 bg-[#0b33a0]" />

      <div className="p-8 sm:p-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="font-display text-[32px] font-bold leading-none tracking-tight text-[#0b33a0]">
              Quote
            </h2>
            <p className="mt-2 font-display text-[16px] font-bold text-[#1e2430]">
              {business.businessName}
            </p>
          </div>
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoUrl}
              alt={business.businessName}
              className="h-[72px] max-w-[160px] shrink-0 object-contain object-right"
            />
          ) : null}
        </div>

        {/* Customer card */}
        <div className="relative mt-7 overflow-hidden rounded-lg border border-[#d4d8e0] bg-[#edf4ff]">
          <div className="absolute inset-y-0 left-0 w-1 bg-[#0b33a0]" />
          <div className="px-5 py-4 pl-6">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6b7280]">
              For:
            </p>
            <div className="mt-1.5 space-y-0.5">
              {document.customer.fullName ? (
                <p className="text-[13px] font-bold text-[#1e2430]">
                  {document.customer.fullName}
                </p>
              ) : (
                <p className="text-[#6b7280]">—</p>
              )}
              {document.customer.email ? (
                <p className="text-[12px] text-[#6b7280]">
                  {document.customer.email}
                </p>
              ) : null}
              {document.customer.phone ? (
                <p className="text-[12px] text-[#6b7280]">
                  {document.customer.phone}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Meta bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-[#d4d8e0] bg-[#f0f2f5] px-3 py-2.5 text-[11px] font-bold">
          <span>
            Quote No:{" "}
            <span className="font-normal">{document.quoteNo}</span>
          </span>
          <span>
            Date:{" "}
            <span className="font-display font-normal tracking-wide">
              {document.quoteDate}
            </span>
          </span>
        </div>

        {/* Line items table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[540px] border-collapse text-[11px]">
            <thead>
              <tr className="border border-[#d4d8e0] bg-[#f0f2f5] text-left text-[10px] font-bold uppercase tracking-wide text-[#6b7280]">
                <th className="border-r border-[#d4d8e0] px-2 py-2.5">Code</th>
                <th className="border-r border-[#d4d8e0] px-2 py-2.5">
                  Description
                </th>
                <th className="border-r border-[#d4d8e0] px-2 py-2.5 text-right">
                  Quantity
                </th>
                <th className="border-r border-[#d4d8e0] px-2 py-2.5 text-right">
                  Rate
                </th>
                <th className="border-r border-[#d4d8e0] px-2 py-2.5 text-right">
                  GST
                </th>
                <th className="px-2 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="border border-[#d4d8e0] px-3 py-8 text-center text-[#6b7280]"
                  >
                    Add line items on the Create tab to preview them here.
                  </td>
                </tr>
              ) : (
                lineItems.map((item, index) => (
                  <tr
                    key={`${item.name}-${index}`}
                    className={`border border-[#d4d8e0] align-top ${
                      index % 2 === 1 ? "bg-[#fafbff]" : "bg-white"
                    }`}
                  >
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5 text-[10px] text-[#6b7280]">
                      {item.code || "—"}
                    </td>
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5">
                      <span className="font-medium text-[#1e2430]">
                        {item.name}
                      </span>
                      {item.description && item.description !== item.name ? (
                        <span className="mt-0.5 block text-[10px] text-[#6b7280]">
                          {item.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5 text-right font-numeric">
                      {item.quantity}
                    </td>
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5 text-right font-numeric">
                      {formatQuoteMoney(item.rateAud)}
                    </td>
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5 text-right font-numeric">
                      {item.gstPercent > 0 ? `${item.gstPercent}%` : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right font-numeric font-bold">
                      {formatQuoteMoney(item.amountAud)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Parts subtotal */}
        {lineItems.length > 0 ? (
          <div className="mt-1 flex justify-end gap-10 border-t-2 border-[#d4d8e0] pt-2 pr-1 text-[12px] font-bold">
            <span>Parts Subtotal</span>
            <span className="font-numeric">
              {formatQuoteMoney(document.subtotalAud)}
            </span>
          </div>
        ) : null}

        {/* Payment details */}
        {document.paymentInstructions?.trim() ? (
          <div className="mt-7 rounded-lg border border-[#d4d8e0] bg-[#edf4ff] p-4">
            <p className="text-[13px] font-bold text-[#0b33a0]">
              Payment Details
            </p>
            <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-[#1e2430]">
              {document.paymentInstructions.trim()}
            </p>
          </div>
        ) : null}

        {/* Totals panel */}
        <div className="mt-8 ml-auto w-full max-w-[240px] overflow-hidden rounded-lg border border-[#d4d8e0]">
          <div className="space-y-2 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-4 text-[#6b7280]">
              <span>Subtotal</span>
              <span className="font-numeric font-medium text-[#1e2430]">
                {formatQuoteMoney(document.subtotalAud)}
              </span>
            </div>
            {document.discountAud > 0 ? (
              <div className="flex justify-between gap-4 text-[#6b7280]">
                <span>Discount</span>
                <span className="font-numeric font-medium text-[#1e2430]">
                  −{formatQuoteMoney(document.discountAud)}
                </span>
              </div>
            ) : null}
            {document.gstAud > 0 ? (
              <div className="flex justify-between gap-2 text-[#6b7280]">
                <span className="min-w-0 text-[10px] leading-snug">
                  GST {business.gstPercentage}% (
                  {formatQuoteMoney(
                    document.subtotalAud - document.discountAud,
                  )}
                  )
                </span>
                <span className="shrink-0 font-numeric font-medium text-[#1e2430]">
                  {formatQuoteMoney(document.gstAud)}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between bg-[#1a1f28] px-4 py-3">
            <span className="text-[13px] font-bold text-white">Total</span>
            <span className="font-numeric text-[15px] font-bold text-white">
              {formatQuoteMoney(document.totalAud)}
            </span>
          </div>
        </div>

        {/* Notes */}
        {document.notes?.trim() ? (
          <div className="mt-8">
            <p className="text-[13px] font-bold text-[#0b33a0]">Notes</p>
            <div className="mt-1 h-0.5 w-12 bg-[#0b33a0]" />
            <p className="mt-3 whitespace-pre-line text-[12px] leading-relaxed text-[#6b7280]">
              {document.notes.trim()}
            </p>
          </div>
        ) : null}

        {/* Footer */}
        <footer className="mt-10 border-t border-[#d4d8e0] pt-5 text-[11px] leading-relaxed text-[#6b7280]">
          {business.address ? <p>{business.address}</p> : null}
          {business.email ? <p className="mt-1">{business.email}</p> : null}
          {business.phone ? <p>{business.phone}</p> : null}
          {business.abn ? <p className="mt-1">ABN: {business.abn}</p> : null}
        </footer>

        <p className="mt-4 text-right text-[10px] text-[#9ca3af]">1 / 1</p>
      </div>
    </div>
  );
}
