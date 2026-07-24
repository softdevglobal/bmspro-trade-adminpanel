"use client";

import { CancelConfirmModal } from "@/components/cancel-confirm-modal";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { PaymentLinkButton } from "@/components/payment-link-button";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import type { InvoiceDetail } from "@/lib/invoices/types";
import { formatAddress } from "@/lib/inspection/types";
import { fetchAdminInvoicePdfBytes } from "@/lib/pdf/fetch-admin-document-pdf";
import { pdfBytesToObjectUrl, printPdfBytes } from "@/lib/pdf/print-pdf";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";
import { formatQuoteDate } from "@/lib/quotations/document";
import { displayBookingCode } from "@/lib/reference-codes";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
type InvoiceFilter = "due" | "draft" | "paid" | "cancelled" | "all";

/** A draft or sent invoice can be cancelled; paid/cancelled cannot. */
function canCancelInvoice(invoice: InvoiceDetail): boolean {
  return invoice.status === "draft" || invoice.status === "sent";
}

const BOARD_SHELL_CLASS = "flex min-h-0 flex-1 flex-col";

function formatAud(value: number | null): string {
  if (value == null) return "—";
  return `Aus $${value.toFixed(2)}`;
}

function formatWhen(timestamp: number | null, timeZone?: string | null): string {
  if (!timestamp) return "—";
  return formatInPlatformTimeZone(timestamp, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }, timeZone);
}

function invoiceStatusLabel(invoice: InvoiceDetail): string {
  if (invoice.status === "sent") return "due";
  return invoice.status;
}

function invoiceStatusTone(invoice: InvoiceDetail): string {
  if (invoice.status === "paid") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (invoice.status === "sent") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (invoice.status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-stone-200 bg-stone-100 text-stone-600";
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-on-primary"
          : "border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant hover:border-primary/40 hover:text-primary"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] ${
          active ? "bg-white/20 text-on-primary" : "bg-surface-container-low"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function InvoiceCardMenu({
  invoice,
  onDelete,
  onCancel,
  onUndoCancel,
}: {
  invoice: InvoiceDetail;
  onDelete: () => void;
  onCancel: () => void;
  onUndoCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editDraftHref = `/dashboard/invoices?invoice=${encodeURIComponent(
    invoice.id,
  )}`;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const menuItemClass =
    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low";

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Invoice actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[20px]">more_vert</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[196px] overflow-hidden rounded-xl border border-outline-variant/80 bg-surface-container-lowest py-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.28)]"
        >
          {invoice.status === "draft" ? (
            <Link
              href={editDraftHref}
              role="menuitem"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                edit_square
              </span>
              Edit &amp; send draft
            </Link>
          ) : null}
          {canCancelInvoice(invoice) ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-amber-600">
                cancel
              </span>
              Cancel invoice
            </button>
          ) : null}
          {invoice.status === "cancelled" ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setOpen(false);
                onUndoCancel();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-emerald-600">
                undo
              </span>
              Undo cancellation
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`${menuItemClass} text-rose-700 hover:bg-rose-50`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <span className="material-symbols-outlined text-[18px] text-rose-600">
              delete
            </span>
            Delete invoice
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InvoiceCard({
  invoice,
  isPreviewOpen,
  onOpen,
  onDelete,
  onCancel,
  onUndoCancel,
}: {
  invoice: InvoiceDetail;
  isPreviewOpen: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onUndoCancel: () => void;
}) {
  const displayPhone = formatAuPhoneDisplay(invoice.customer.phone);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`group relative flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-surface-container-lowest p-4 text-left shadow-sm transition-all sm:p-5 sm:hover:-translate-y-0.5 ${
        isPreviewOpen
          ? "border-primary/40 ring-2 ring-primary/15"
          : "border-outline-variant/60 hover:border-primary/30 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-800">
            {invoice.invoiceCode}
          </span>
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${invoiceStatusTone(
              invoice,
            )}`}
          >
            {invoiceStatusLabel(invoice)}
          </span>
        </div>
        <InvoiceCardMenu
          invoice={invoice}
          onDelete={onDelete}
          onCancel={onCancel}
          onUndoCancel={onUndoCancel}
        />
      </div>
      <h4 className="font-display text-[16px] font-semibold text-on-surface">
        {invoice.customer.fullName || "Customer"}
      </h4>
      <p className="font-body text-[13px] text-on-surface-variant">
        Service: {invoice.serviceTitle || "Invoice"}
      </p>
      <p className="font-body text-[13px] text-on-surface-variant">
        {displayPhone || "—"}
      </p>
      <p className="font-body text-[12px] text-on-surface-variant">
        {formatAddress(invoice.address)}
      </p>

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-outline-variant/40 pt-3">
        <span className="font-numeric text-[15px] font-semibold text-primary">
          {formatAud(invoice.finalPriceAud)}
        </span>
        {invoice.depositRequest ? (
          <span className="font-body text-[11px] text-on-surface-variant">
            Balance {formatAud(invoice.balanceDueAud)}
          </span>
        ) : null}
        <span className="font-body text-[11px] text-on-surface-variant sm:ml-auto">
          Due {formatQuoteDate(invoice.dueDate)}
        </span>
      </div>
    </div>
  );
}

function InvoicePreviewDrawer({
  invoice,
  onClose,
  onInvoiceUpdated,
  onDelete,
  onCancel,
  onUndoCancel,
  timeZone,
}: {
  invoice: InvoiceDetail | null;
  onClose: () => void;
  onInvoiceUpdated: (invoice: InvoiceDetail) => void;
  onDelete: (invoice: InvoiceDetail) => void;
  onCancel: (invoice: InvoiceDetail) => void;
  onUndoCancel: (invoice: InvoiceDetail) => void;
  timeZone?: string | null;
}) {  const { user } = useAuth();
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfSource, setPdfSource] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [markPaidLoading, setMarkPaidLoading] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);
  const open = invoice !== null;
  useRegisterRightDrawer(open, "lg");
  const editDraftHref = invoice
    ? `/dashboard/invoices?invoice=${encodeURIComponent(invoice.id)}`
    : "/dashboard/invoices";
  const displayPhone = invoice
    ? formatAuPhoneDisplay(invoice.customer.phone)
    : "";
  const contactLine = invoice
    ? [displayPhone, invoice.customer.email].filter(Boolean).join(" · ") || "—"
    : "—";

  function closePdf() {
    setPdfOpen(false);
    if (pdfSource?.startsWith("blob:")) {
      URL.revokeObjectURL(pdfSource);
    }
    setPdfSource(null);
    setPdfError(null);
  }

  async function fetchInvoicePdfBytes(): Promise<Uint8Array> {
    if (!invoice || !user) {
      throw new Error("Could not open invoice PDF.");
    }
    return fetchAdminInvoicePdfBytes(user, invoice.id);
  }

  async function openPdf() {
    if (!invoice || !user) return;
    setPdfError(null);
    setPdfLoading(true);
    try {
      const bytes = await fetchInvoicePdfBytes();
      setPdfSource(pdfBytesToObjectUrl(bytes));
      setPdfOpen(true);
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : "Could not open invoice PDF.",
      );
    } finally {
      setPdfLoading(false);
    }
  }

  async function printInvoice() {
    if (!invoice || !user) return;
    setPdfError(null);
    setPrintLoading(true);
    try {
      const bytes = await fetchInvoicePdfBytes();
      await printPdfBytes(bytes);
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : "Could not print invoice PDF.",
      );
    } finally {
      setPrintLoading(false);
    }
  }

  async function markAsPaid() {
    if (!invoice || !user) return;
    setMarkPaidLoading(true);
    setMarkPaidError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "mark_paid",
          invoiceId: invoice.id,
        }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        invoice?: InvoiceDetail;
      };
      if (!response.ok || !body.ok || !body.invoice) {
        throw new Error(body.error ?? "Could not mark invoice as paid.");
      }
      onInvoiceUpdated(body.invoice);
    } catch (error) {
      setMarkPaidError(
        error instanceof Error
          ? error.message
          : "Could not mark invoice as paid.",
      );
    } finally {
      setMarkPaidLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && invoice ? (
        <motion.div
          key="invoice-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 overflow-hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            key="invoice-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice preview: ${invoice.invoiceCode}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-full flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl will-change-transform sm:w-full sm:max-w-[720px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Invoice preview
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-800">
                    {invoice.invoiceCode}
                  </span>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${invoiceStatusTone(
                      invoice,
                    )}`}
                  >
                    {invoiceStatusLabel(invoice)}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-[20px] font-semibold text-on-surface">
                  {invoice.serviceTitle || "Invoice"}
                </h3>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Issued {formatQuoteDate(invoice.invoiceDate)} · Due{" "}
                  {formatQuoteDate(invoice.dueDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
              <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Customer
                </p>
                <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
                  {invoice.customer.fullName}
                </p>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  {contactLine}
                </p>
                <p className="mt-2 font-body text-[13px] text-on-surface">
                  {formatAddress(invoice.address)}
                </p>
              </section>

              <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Line items
                </p>
                <ul className="mt-2 space-y-1.5">
                  {invoice.lineItems.map((item, index) => (
                    <li
                      key={`${item.name}-${index}`}
                      className="flex items-center justify-between gap-3 font-body text-[13px]"
                    >
                      <span className="text-on-surface">{item.name}</span>
                      <span className="font-numeric shrink-0 font-semibold text-on-surface">
                        {formatAud(item.priceAud)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-outline-variant/40 pt-2 font-body text-[13px] font-semibold">
                  <span>Subtotal</span>
                  <span className="font-numeric">{formatAud(invoice.subtotalAud)}</span>
                </div>
                {invoice.discountAud > 0 ? (
                  <div className="mt-1 flex items-center justify-between font-body text-[13px] text-on-surface-variant">
                    <span>Discount</span>
                    <span className="font-numeric">
                      -{formatAud(invoice.discountAud)}
                    </span>
                  </div>
                ) : null}
                {invoice.gstAud > 0 ? (
                  <div className="mt-1 flex items-center justify-between font-body text-[13px] text-on-surface-variant">
                    <span>GST</span>
                    <span className="font-numeric">{formatAud(invoice.gstAud)}</span>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2 font-body text-[14px] font-bold text-primary">
                  <span>Total</span>
                  <span className="font-numeric">{formatAud(invoice.finalPriceAud)}</span>
                </div>
                {invoice.depositRequest ? (
                  <>
                    <div className="mt-2 flex items-center justify-between font-body text-[13px] text-on-surface-variant">
                      <span>
                        {invoice.depositRequest.paid
                          ? "Deposit paid"
                          : "Deposit requested"}
                      </span>
                      <span
                        className={`font-numeric font-semibold ${
                          invoice.depositRequest.paid
                            ? "text-emerald-600"
                            : "text-on-surface"
                        }`}
                      >
                        {invoice.depositRequest.paid
                          ? `−${formatAud(invoice.depositRequest.amountAud)}`
                          : formatAud(invoice.depositRequest.amountAud)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-body text-[13px] text-on-surface-variant">
                      <span>Balance due</span>
                      <span className="font-numeric font-semibold text-on-surface">
                        {formatAud(invoice.balanceDueAud)}
                      </span>
                    </div>
                  </>
                ) : null}
              </section>

              {invoice.status !== "draft" && invoice.status !== "cancelled" ? (
                <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Online payments
                  </p>
                  {invoice.payments.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {invoice.payments.map((payment, index) => (
                        <li
                          key={payment.stripeCheckoutSessionId ?? index}
                          className="flex items-center justify-between gap-3 font-body text-[13px]"
                        >
                          <span className="min-w-0 text-on-surface">
                            <span className="material-symbols-outlined align-middle text-[15px] text-emerald-600">
                              check_circle
                            </span>{" "}
                            {formatWhen(payment.paidAt, timeZone)}
                            {payment.stripePaymentIntentId ? (
                              <span className="ml-1 block truncate font-mono text-[11px] text-on-surface-variant sm:inline">
                                {payment.stripePaymentIntentId}
                              </span>
                            ) : null}
                          </span>
                          <span className="font-numeric shrink-0 font-semibold text-emerald-700">
                            {formatAud(payment.amountAud)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                      No online payments yet.
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-outline-variant/40 pt-2 font-body text-[13px]">
                    <span className="text-on-surface-variant">
                      {invoice.status === "paid" ? "Paid in full" : "Balance due"}
                    </span>
                    <span
                      className={`font-numeric font-semibold ${
                        invoice.status === "paid"
                          ? "text-emerald-600"
                          : "text-on-surface"
                      }`}
                    >
                      {formatAud(
                        invoice.status === "paid"
                          ? invoice.amountPaidAud || invoice.finalPriceAud
                          : invoice.balanceDueAud,
                      )}
                    </span>
                  </div>
                  {invoice.status === "sent" && invoice.balanceDueAud > 0 ? (
                    <div className="mt-3">
                      <PaymentLinkButton
                        type="invoice"
                        targetId={invoice.id}
                        label="Copy payment link"
                        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <p className="mt-1.5 font-body text-[11px] text-on-surface-variant">
                        Share this secure link for the customer to pay{" "}
                        {formatAud(invoice.balanceDueAud)} online.
                      </p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {invoice.notes ? (
                <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line font-body text-[13px] text-on-surface">
                    {invoice.notes}
                  </p>
                </section>
              ) : null}

              {invoice.quotationCode ? (
                <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-3">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Linked quotation
                  </p>
                  <Link
                    href="/dashboard/quotations"
                    onClick={onClose}
                    className="mt-1 inline-flex font-mono text-[13px] font-semibold text-primary hover:underline"
                  >
                    {invoice.quotationCode}
                  </Link>
                </section>
              ) : null}

              {invoice.bookingId ? (
                <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
                    Linked job
                  </p>
                  <p className="mt-1 font-mono text-[13px] font-semibold text-primary">
                    {displayBookingCode({
                      id: invoice.bookingId,
                      bookingCode: invoice.bookingCode,
                    })}
                  </p>
                </section>
              ) : null}
            </div>

            <footer className="shrink-0 space-y-2 border-t border-outline-variant/40 px-4 py-4 sm:px-5">
              {invoice.status === "sent" ? (
                <button
                  type="button"
                  onClick={() => void markAsPaid()}
                  disabled={markPaidLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-[20px] ${
                      markPaidLoading ? "animate-spin" : ""
                    }`}
                  >
                    {markPaidLoading ? "progress_activity" : "paid"}
                  </span>
                  {markPaidLoading ? "Marking paid…" : "Mark as paid"}
                </button>
              ) : null}
              {invoice.status === "draft" ? (
                <Link
                  href={editDraftHref}
                  onClick={onClose}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    edit_square
                  </span>
                  Edit &amp; send draft
                </Link>
              ) : null}
              {markPaidError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
                >
                  {markPaidError}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void openPdf()}
                  disabled={pdfLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-body text-[14px] font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-[20px] ${
                      pdfLoading ? "animate-spin" : ""
                    }`}
                  >
                    {pdfLoading ? "progress_activity" : "picture_as_pdf"}
                  </span>
                  {pdfLoading ? "Loading PDF…" : "View invoice PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => void printInvoice()}
                  disabled={printLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/60 bg-white px-4 py-3 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className={`material-symbols-outlined text-[20px] ${
                      printLoading ? "animate-spin" : ""
                    }`}
                  >
                    {printLoading ? "progress_activity" : "print"}
                  </span>
                  {printLoading ? "Preparing…" : "Print invoice"}
                </button>
              </div>
              {pdfError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
                >
                  {pdfError}
                </p>
              ) : null}
              {invoice.status === "cancelled" ? (
                <button
                  type="button"
                  onClick={() => onUndoCancel(invoice)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-body text-[14px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    undo
                  </span>
                  Undo cancellation
                </button>
              ) : canCancelInvoice(invoice) ? (
                <button
                  type="button"
                  onClick={() => onCancel(invoice)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[14px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    cancel
                  </span>
                  Cancel invoice
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onDelete(invoice)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[14px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
              >
                <span className="material-symbols-outlined text-[20px]">
                  delete
                </span>
                Delete invoice
              </button>
              <p className="text-center font-body text-[11px] text-on-surface-variant">                Created {formatWhen(invoice.createdAt, timeZone)}
              </p>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}

      {pdfOpen && invoice && user ? (
        <QuotationPdfViewerModal
          open={pdfOpen}
          onClose={closePdf}
          pdfUrl={pdfSource ?? ""}
          title={`Invoice — ${invoice.invoiceCode ?? "Invoice"}`}
          downloadFilename={`${(invoice.invoiceCode ?? "invoice")
            .replace(/[^a-z0-9.\-]+/gi, "-")
            .toLowerCase()}.pdf`}
          loadPdfBytes={() => fetchAdminInvoicePdfBytes(user, invoice.id)}
        />
      ) : null}
    </AnimatePresence>
  );
}

export function InvoicesBoard() {
  const { user, status: authStatus } = useAuth();
  const profile = useBusinessProfile();
  const [invoices, setInvoices] = useState<InvoiceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InvoiceFilter>("due");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<InvoiceDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const timeZone = profile?.timezone;
  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/invoices", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const raw = await response.text();
      let data: {
        ok?: boolean;
        error?: string;
        invoices?: InvoiceDetail[];
      } = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          throw new Error("Could not load invoices.");
        }
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not load invoices.");
      }
      setInvoices(data.invoices ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load invoices.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "due") {
      return invoices.filter((invoice) => invoice.status === "sent");
    }
    if (filter === "all") return invoices;
    return invoices.filter((invoice) => invoice.status === filter);
  }, [invoices, filter]);

  const counts = useMemo(
    () => ({
      all: invoices.length,
      due: invoices.filter((invoice) => invoice.status === "sent").length,
      draft: invoices.filter((invoice) => invoice.status === "draft").length,
      paid: invoices.filter((invoice) => invoice.status === "paid").length,
      cancelled: invoices.filter((invoice) => invoice.status === "cancelled")
        .length,
    }),
    [invoices],
  );

  const selected = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedId) ?? null,
    [invoices, selectedId],
  );

  async function confirmDeleteInvoice() {
    if (!user || !deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/invoices/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not delete invoice.");
      }
      setInvoices((current) =>
        current.filter((invoice) => invoice.id !== deleteTarget.id),
      );
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
      }
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete invoice.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function confirmCancelInvoice() {
    if (!user || !cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "cancel",
          invoiceId: cancelTarget.id,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        invoice?: InvoiceDetail;
      };
      if (!response.ok || !data.ok || !data.invoice) {
        throw new Error(data.error ?? "Could not cancel invoice.");
      }
      const cancelledInvoice = data.invoice;
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === cancelledInvoice.id ? cancelledInvoice : invoice,
        ),
      );
      setCancelTarget(null);
      setFilter("cancelled");
    } catch (cancelErr) {
      setCancelError(
        cancelErr instanceof Error
          ? cancelErr.message
          : "Could not cancel invoice.",
      );
    } finally {
      setCancelling(false);
    }
  }

  async function undoCancelInvoice(target: InvoiceDetail) {
    if (!user) return;
    setCancelError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/invoices", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "undo_cancel",
          invoiceId: target.id,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        invoice?: InvoiceDetail;
      };
      if (!response.ok || !data.ok || !data.invoice) {
        throw new Error(data.error ?? "Could not restore invoice.");
      }
      const restoredInvoice = data.invoice;
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === restoredInvoice.id ? restoredInvoice : invoice,
        ),
      );
    } catch (undoErr) {
      setCancelError(
        undoErr instanceof Error
          ? undoErr.message
          : "Could not restore invoice.",
      );
    }
  }

  if (authStatus === "loading" || loading) {    return (
      <div className={BOARD_SHELL_CLASS}>
        <div className="space-y-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={BOARD_SHELL_CLASS}>
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
        >
          {error}
        </div>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className={BOARD_SHELL_CLASS}>
      <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
        <span className="material-symbols-outlined text-[40px] text-outline-variant">
          receipt_long
        </span>
        <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
          No invoices yet
        </p>
        <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
          Issue an invoice from a sent quotation, or create one after a job is
          complete.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard/invoices?new=1"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Create invoice
          </Link>
          <Link
            href="/dashboard/quotations"
            className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low px-5 py-2.5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">
              request_quote
            </span>
            View quotations
          </Link>
          <Link
            href="/dashboard/requests"
            className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low px-5 py-2.5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">
              event_available
            </span>
            Requests
          </Link>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className={BOARD_SHELL_CLASS}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-body text-[12px] text-on-surface-variant">
          {filtered.length} invoice{filtered.length === 1 ? "" : "s"} · tap a
          card to open the side preview
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/quotations"
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-4 py-2 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">
              request_quote
            </span>
            From quotation
          </Link>
          <Link
            href="/dashboard/invoices?new=1"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Create invoice
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip
          label="Due"
          count={counts.due}
          active={filter === "due"}
          onClick={() => setFilter("due")}
        />
        <FilterChip
          label="Draft"
          count={counts.draft}
          active={filter === "draft"}
          onClick={() => setFilter("draft")}
        />
        <FilterChip
          label="Paid"
          count={counts.paid}
          active={filter === "paid"}
          onClick={() => setFilter("paid")}
        />
        <FilterChip
          label="Cancelled"
          count={counts.cancelled}
          active={filter === "cancelled"}
          onClick={() => setFilter("cancelled")}
        />
        <FilterChip
          label="All"
          count={counts.all}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
      </div>

      {cancelError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-800"
        >
          {cancelError}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low px-5 py-10 text-center">
          <p className="font-body text-[14px] text-on-surface-variant">
            No {filter} invoices.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((invoice) => (
            <li key={invoice.id}>
              <InvoiceCard
                invoice={invoice}
                isPreviewOpen={selectedId === invoice.id}
                onOpen={() => setSelectedId(invoice.id)}
                onDelete={() => setDeleteTarget(invoice)}
                onCancel={() => setCancelTarget(invoice)}
                onUndoCancel={() => void undoCancelInvoice(invoice)}
              />            </li>
          ))}
        </ul>
      )}

      <InvoicePreviewDrawer
        invoice={selected}
        onClose={() => setSelectedId(null)}
        timeZone={timeZone}
        onDelete={(invoice) => setDeleteTarget(invoice)}
        onCancel={(invoice) => setCancelTarget(invoice)}
        onUndoCancel={(invoice) => void undoCancelInvoice(invoice)}
        onInvoiceUpdated={(updatedInvoice) => {
          setInvoices((current) =>
            current.map((invoice) =>
              invoice.id === updatedInvoice.id ? updatedInvoice : invoice,
            ),
          );
          if (updatedInvoice.status === "paid") {
            setFilter("paid");
          }
        }}
      />
      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="Delete this invoice?"
        description={
          deleteTarget
            ? `Only ${deleteTarget.invoiceCode} for ${
                deleteTarget.customer.fullName || "this customer"
              } will be permanently removed. Any linked quotation and request will be kept. This cannot be undone.`
            : ""
        }
        confirmLabel="Yes, delete invoice"
        cancelLabel="Keep invoice"
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteInvoice()}
        isLoading={deleting}
      />
      <CancelConfirmModal
        open={cancelTarget !== null}
        title="Cancel this invoice?"
        description={
          cancelTarget ? (
            <>
              <p>
                {cancelTarget.invoiceCode} for{" "}
                <span className="font-semibold text-on-surface">
                  {cancelTarget.customer.fullName || "this customer"}
                </span>{" "}
                will move to the Cancelled tab.
              </p>
              <p>
                It stays on record for reference, but can no longer be sent or
                marked as paid.
              </p>
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Yes, cancel invoice"
        cancelLabel="Keep invoice"
        loadingLabel="Cancelling..."
        onCancel={() => {
          if (!cancelling) setCancelTarget(null);
        }}
        onConfirm={() => void confirmCancelInvoice()}
        isLoading={cancelling}
      />
    </div>
  );
}