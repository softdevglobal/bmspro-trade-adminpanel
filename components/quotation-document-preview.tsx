"use client";

import { PRINT_DOCUMENT_ROOT } from "@/lib/pdf/print-document-preview";
import {
  formatQuoteMoney,
  formatQuoteDate,
  formatDepositSummary,
  formatDocumentDiscountLabel,
  formatGstTotalsLabel,
  formatLineDiscountLabel,
  grossSubtotalAud,
  totalLineDiscountAud,
  type QuotationDocumentData,
} from "@/lib/quotations/document";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";

type Props = {
  document: QuotationDocumentData;
  className?: string;
  /** When `invoice`, labels and layout match a tax invoice instead of a quote. */
  kind?: "quote" | "invoice";
};

/**
 * HTML preview that mirrors the generated quotation PDF layout.
 */
export function QuotationDocumentPreview({
  document,
  className = "",
  kind = "quote",
}: Props) {
  const { business, lineItems } = document;
  const serviceDescription = document.serviceDescription?.trim() ?? "";
  const isInvoice = kind === "invoice";
  const docLabel = isInvoice ? "Tax Invoice" : "Quote";
  const numberLabel = isInvoice ? "Invoice No" : "Quote No";
  const dateLabel = isInvoice ? "Due date" : "Valid until";
  const displayCustomerPhone = formatAuPhoneDisplay(document.customer.phone);
  const lineDiscountTotalAud = totalLineDiscountAud(lineItems);
  const itemsGrossSubtotalAud = grossSubtotalAud(lineItems);
  const hasLineDiscounts = lineDiscountTotalAud > 0.01;
  const hasDocumentDiscount = document.discountAud > 0.01;
  const documentDiscountLabel = formatDocumentDiscountLabel(
    document.discountAud,
    document.subtotalAud,
    document.documentDiscount,
  );
  const depositBalanceDueAud =
    document.deposit && isInvoice && !document.deposit.paid
      ? document.totalAud
      : (document.deposit?.balanceDueAud ?? 0);

  return (
    <div
      {...{ [PRINT_DOCUMENT_ROOT]: true }}
      className={`relative mx-auto w-full max-w-[720px] overflow-hidden font-body text-[13px] leading-relaxed text-[#1e2430] shadow-[0_8px_32px_rgba(11,51,160,0.12)] ring-1 ring-[#d0dae8] ${className}`}
    >
      {/* Pearl page surface — no side rail, no white card overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#f6f8fc] via-[#fafbfc] to-[#fdfcfb]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-60 w-60 rounded-full bg-[#0b33a0]/[0.045]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[45%] bottom-[12%] h-52 w-52 rounded-full bg-[#b8cff5]/30"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-8 -left-8 h-44 w-44 rounded-full bg-[#f0e8dc]/50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #0b33a0 0.55px, transparent 0)",
          backgroundSize: "18px 19px",
        }}
      />
      <p
        aria-hidden
        className="pointer-events-none absolute left-[14%] top-[40%] rotate-[-18deg] select-none font-display text-[clamp(72px,16vw,128px)] font-bold leading-none text-[#0b33a0]/[0.022]"
      >
        {isInvoice ? "INVOICE" : "QUOTE"}
      </p>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#0b33a0]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-4 rounded-sm border border-[#ccd5e3]/70 sm:inset-5"
      />

      <div className="relative px-8 py-9 sm:px-10 sm:py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="font-display text-[34px] font-bold leading-none tracking-tight text-[#0b33a0]">
              {docLabel}
            </h2>
            <div className="mt-2 h-1 w-14 rounded-full bg-[#0b33a0]" />
            <p className="mt-3 font-display text-[16px] font-bold text-[#1e2430]">
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
        <div className="relative mt-7 overflow-hidden rounded-lg border border-[#c5d0e0] bg-white/90 shadow-sm backdrop-blur-[1px]">
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
              {displayCustomerPhone ? (
                <p className="text-[12px] text-[#6b7280]">
                  {displayCustomerPhone}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {document.serviceTitle || serviceDescription ? (
          <div className="relative mt-4 overflow-hidden rounded-lg border border-[#c5d0e0] bg-white/90 shadow-sm backdrop-blur-[1px]">
            <div className="absolute inset-y-0 left-0 w-1 bg-[#0b33a0]" />
            <div className="px-5 py-3 pl-6">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6b7280]">
                Service
              </p>
              {document.serviceTitle ? (
                <p className="mt-1 text-[13px] font-bold text-[#1e2430]">
                  {document.serviceTitle}
                </p>
              ) : null}
              {serviceDescription ? (
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#6b7280]">
                  {serviceDescription}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Meta bar */}
        <div className="relative mt-4 overflow-hidden rounded border border-[#c5cfe0] bg-white/75 px-3 py-2.5 text-[11px] font-bold backdrop-blur-[1px]">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-[#0b33a0]/12" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {numberLabel}:{" "}
              <span className="font-normal">{document.quoteNo}</span>
            </span>
            <span>
              Date:{" "}
              <span className="font-display font-normal tracking-wide">
                {document.quoteDate}
              </span>
            </span>
          </div>
          {document.validUntil ? (
            <p className="mt-1.5 font-normal text-[#6b7280]">
              {dateLabel}:{" "}
              <span className="font-medium text-[#1e2430]">
                {formatQuoteDate(document.validUntil)}
              </span>
            </p>
          ) : null}
        </div>

        {/* Line items table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead>
              <tr className="border border-[#c5cfe0] border-t-2 border-t-[#0b33a0]/15 bg-white/80 text-left text-[10px] font-bold uppercase tracking-wide text-[#6b7280] backdrop-blur-[1px]">
                <th className="border-r border-[#c5cfe0] px-2 py-2.5">
                  Code
                </th>
                <th className="border-r border-[#c5cfe0] px-2 py-2.5">
                  Description
                </th>
                <th className="border-r border-[#c5cfe0] px-2 py-2.5 text-right">
                  Quantity
                </th>
                <th className="border-r border-[#c5cfe0] px-2 py-2.5 text-right">
                  Rate
                </th>
                <th className="border-r border-[#c5cfe0] px-2 py-2.5 text-right">
                  Disc.
                </th>
                <th className="border-r border-[#c5cfe0] px-2 py-2.5 text-right">
                  GST
                </th>
                <th className="px-2 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="border border-[#d4d8e0] bg-white/60 px-3 py-8 text-center text-[#6b7280]"
                  >
                    Add line items on the Create tab to preview them here.
                  </td>
                </tr>
              ) : (
                lineItems.map((item, index) => (
                  <tr
                    key={`${item.name}-${index}`}
                    className={`border border-[#d4d8e0] align-top ${
                      index % 2 === 0
                        ? "bg-white/75"
                        : "bg-[#f3f6fa]/80"
                    }`}
                  >
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5 text-[10px] text-[#6b7280]">
                      {item.code || "—"}
                    </td>
                    <td className="border-r border-[#d4d8e0] px-2 py-2.5">
                      <span className="font-medium text-[#1e2430]">
                        {item.name}
                      </span>
                      {item.description &&
                      item.description !== item.name ? (
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
                      {formatLineDiscountLabel(item)}
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

        {/* Subtotal */}
        {lineItems.length > 0 ? (
          <div className="mt-1 space-y-1 text-right text-[12px]">
            {hasLineDiscounts ? (
              <>
                <div className="flex justify-end gap-10 pr-1 text-[#6b7280]">
                  <span>Items subtotal</span>
                  <span className="font-numeric font-medium">
                    {formatQuoteMoney(itemsGrossSubtotalAud)}
                  </span>
                </div>
                <div className="flex justify-end gap-10 pr-1 text-[#6b7280]">
                  <span>Item discount</span>
                  <span className="font-numeric font-medium">
                    −{formatQuoteMoney(lineDiscountTotalAud)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-end gap-10 border-t-2 border-[#d4d8e0] pt-2 pr-1 font-bold">
              <span>Subtotal</span>
              <span className="font-numeric">
                {formatQuoteMoney(document.subtotalAud)}
              </span>
            </div>
          </div>
        ) : null}

        {/* Terms + totals */}
        <div
          className={`mt-7 ${document.termsAndConditions?.trim() ? "flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between" : ""}`}
        >
          {document.termsAndConditions?.trim() ? (
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-[#c5d0e0] bg-white/90 p-4 shadow-sm backdrop-blur-[1px]">
              <div className="absolute inset-y-0 left-0 w-1 bg-[#0b33a0]" />
              <p className="text-[13px] font-bold text-[#0b33a0]">
                Terms and conditions
              </p>
              <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-[#1e2430]">
                {document.termsAndConditions.trim()}
              </p>
            </div>
          ) : null}

          <div
            className={`w-full max-w-[240px] shrink-0 overflow-hidden rounded-lg border border-[#c5d0e0] bg-white/90 shadow-sm backdrop-blur-[1px] ${document.termsAndConditions?.trim() ? "sm:ml-2" : "mt-8 ml-auto"}`}
          >
          <div className="space-y-2 px-4 py-3 text-[12px]">
            {hasLineDiscounts ? (
              <>
                <div className="flex justify-between gap-4 text-[#6b7280]">
                  <span>Items subtotal</span>
                  <span className="font-numeric font-medium text-[#1e2430]">
                    {formatQuoteMoney(itemsGrossSubtotalAud)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-[#6b7280]">
                  <span>Item discount</span>
                  <span className="font-numeric font-medium text-[#1e2430]">
                    −{formatQuoteMoney(lineDiscountTotalAud)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-4 text-[#6b7280]">
              <span>Subtotal</span>
              <span className="font-numeric font-medium text-[#1e2430]">
                {formatQuoteMoney(document.subtotalAud)}
              </span>
            </div>
            {hasDocumentDiscount ? (
              <div className="flex justify-between gap-4 text-[#6b7280]">
                <span>{documentDiscountLabel}</span>
                <span className="font-numeric font-medium text-[#1e2430]">
                  −{formatQuoteMoney(document.discountAud)}
                </span>
              </div>
            ) : null}
            {document.gstAud > 0 ? (
              <div className="flex justify-between gap-2 text-[#6b7280]">
                <span className="min-w-0 text-[10px] leading-snug">
                  {formatGstTotalsLabel({
                    gstPercentage: business.gstPercentage,
                    gstPricing: document.gstPricing,
                    gstTaxableBaseAud: document.gstTaxableBaseAud,
                    afterDiscountAud:
                      document.subtotalAud - document.discountAud,
                  })}
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
          {document.deposit ? (
            <>
              <div className="space-y-0.5 border-t border-[#c5d0e0] px-4 py-3 text-[12px]">
                <div className="flex justify-between gap-4 text-[#6b7280]">
                  <span>
                    {document.deposit.paid
                      ? "Deposit paid"
                      : isInvoice
                        ? "Deposit not paid"
                        : "Deposit due"}
                  </span>
                  <span
                    className={`font-numeric font-medium ${
                      document.deposit.paid ? "text-[#047857]" : "text-[#1e2430]"
                    }`}
                  >
                    {document.deposit.paid
                      ? `−${formatQuoteMoney(document.deposit.amountAud)}`
                      : formatQuoteMoney(document.deposit.amountAud)}
                  </span>
                </div>
                <p className="text-[10px] text-[#9ca3af]">
                  {formatDepositSummary(document.deposit)}
                </p>
              </div>
              {isInvoice ? (
                <div className="flex items-center justify-between bg-[#0b33a0] px-4 py-3">
                  <span className="text-[13px] font-bold text-white">
                    Balance due
                  </span>
                  <span className="font-numeric text-[15px] font-bold text-white">
                    {formatQuoteMoney(depositBalanceDueAud)}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          </div>
        </div>

        {/* Comments */}
        {document.notes?.trim() ? (
          <div className="mt-8">
            <p className="text-[13px] font-bold text-[#0b33a0]">Comments</p>
            <div className="mt-1 h-0.5 w-12 bg-[#0b33a0]" />
            <p className="mt-3 whitespace-pre-line text-[12px] leading-relaxed text-[#6b7280]">
              {document.notes.trim()}
            </p>
          </div>
        ) : null}

        {/* Footer */}
        <footer className="mt-10 border-t border-[#ccd5e3] pt-5 text-[11px] leading-relaxed text-[#6b7280]">
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
