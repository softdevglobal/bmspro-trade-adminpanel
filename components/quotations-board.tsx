"use client";

import {
  bookingMinDateFromInspection,
  canConvertQuotationToBooking,
  ConvertToBookingPanel,
} from "@/components/convert-to-booking-panel";
import { FollowUpActionButtons } from "@/components/follow-up-action-buttons";
import { QuotationOwnerDecisionButtons } from "@/components/quotation-owner-decision-buttons";
import { InspectionRequestCode } from "@/components/inspection-request-code";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONE,
  type BookingStatus,
} from "@/lib/bookings/types";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import {
  CREATED_SOURCE_LABELS,
  formatAddress,
  type InspectionRequestCreatedSource,
} from "@/lib/inspection/types";
import {
  canCancelQuotation,
  quotationAwaitingCustomerAcceptance,
  quotationHasInvoice,
  quotationJobActionsLocked,
} from "@/lib/quotations/actions";
import type { QuotationDetail } from "@/lib/quotations/types";
import { displayBookingCode, displayQuotationCode } from "@/lib/reference-codes";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type QuotationPreviewMode = "review" | "convert_booking";
type QuotationFilter =
  | "pending"
  | "completed"
  | "all"
  | QuotationDetail["status"];

const QUOTATION_TABS: { id: QuotationFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

function isCompletedQuotation(quotation: QuotationDetail): boolean {
  return quotationHasInvoice(quotation);
}

function isPendingQuotation(quotation: QuotationDetail): boolean {
  return quotation.status !== "cancelled" && !isCompletedQuotation(quotation);
}

function quotationFilterLabel(filter: QuotationFilter): string {
  if (filter === "all") return "";
  return QUOTATION_TABS.find((tab) => tab.id === filter)?.label ?? "Quotation";
}

const disabledActionClass =
  "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-low/80 px-4 py-3 font-body text-[14px] font-semibold text-on-surface-variant opacity-50";

const disabledMenuItemClass =
  "flex w-full cursor-not-allowed items-center gap-2.5 px-3.5 py-2.5 text-left font-body text-[13px] font-semibold text-on-surface-variant opacity-50";

function StatusPill({ status }: { status: QuotationDetail["status"] }) {
  const tone =
    status === "sent"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : status === "cancelled"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function CompletedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-emerald-700">
      <span className="material-symbols-outlined text-[13px] leading-none">
        task_alt
      </span>
      Completed
    </span>
  );
}

function BookingStatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${BOOKING_STATUS_TONE[status]}`}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

function CreatedSourcePill({
  source,
}: {
  source: InspectionRequestCreatedSource | null | undefined;
}) {
  if (!source) return null;
  const label = CREATED_SOURCE_LABELS[source];
  const icon =
    source === "booking_engine"
      ? "language"
      : source === "owner_mobile"
        ? "smartphone"
        : source === "quotation_direct"
          ? "request_quote"
          : "dashboard";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant/60 bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
      <span className="material-symbols-outlined text-[12px] leading-none text-primary">
        {icon}
      </span>
      {label}
    </span>
  );
}

function CustomerDecisionPill({
  quotation,
}: {
  quotation: Pick<
    QuotationDetail,
    "status" | "bookingId" | "customerDecision"
  >;
}) {
  if (quotation.status !== "sent") return null;
  if (quotation.customerDecision === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-emerald-700">
        <span className="material-symbols-outlined text-[13px] leading-none">
          check_circle
        </span>
        Customer accepted
      </span>
    );
  }
  if (quotation.customerDecision === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-rose-700">
        <span className="material-symbols-outlined text-[13px] leading-none">
          cancel
        </span>
        Customer rejected
      </span>
    );
  }
  if (quotation.bookingId) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-amber-700">
      <span className="material-symbols-outlined text-[13px] leading-none">
        hourglass_top
      </span>
      Awaiting customer
    </span>
  );
}

function QuotationCardMenu({
  quotation,
  onScheduleBooking,
  onCancelQuotation,
  onUndoCancel,
}: {
  quotation: QuotationDetail;
  onScheduleBooking: () => void;
  onCancelQuotation: () => void;
  onUndoCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canSchedule = canConvertQuotationToBooking(quotation);
  const hasBooking = Boolean(quotation.bookingId);
  const hasInvoice = quotationHasInvoice(quotation);
  const jobLocked = quotationJobActionsLocked(quotation);
  const awaitingCustomer = quotationAwaitingCustomerAcceptance(quotation);
  const canCancel = canCancelQuotation(quotation);
  const awaitingCustomerTitle =
    quotation.customerDecision === "rejected"
      ? "The customer rejected this quotation"
      : "Waiting for the customer to accept this quotation";
  const invoiceHref = `/dashboard/invoices?quotation=${encodeURIComponent(quotation.id)}`;
  const editDraftHref = `/dashboard/quotations/new?quotationId=${encodeURIComponent(quotation.id)}`;
  const isCancelled = quotation.status === "cancelled";
  const canIssueInvoice =
    quotation.status === "sent" && !hasInvoice && !awaitingCustomer;

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
    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Quotation actions"
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
          {quotation.status === "draft" ? (
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
          {canSchedule ? (
            <button
              type="button"
              role="menuitem"
              disabled={jobLocked || awaitingCustomer}
              className={menuItemClass}
              title={
                jobLocked
                  ? "Job completed and invoice already issued"
                  : awaitingCustomer
                    ? awaitingCustomerTitle
                    : undefined
              }
              onClick={() => {
                if (jobLocked || awaitingCustomer) return;
                setOpen(false);
                onScheduleBooking();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                event
              </span>
              Schedule job
            </button>
          ) : hasBooking ? (
            jobLocked ? (
              <span
                role="menuitem"
                className={disabledMenuItemClass}
                title="Job completed and invoice already issued"
              >
                <span className="material-symbols-outlined text-[18px] text-outline">
                  assignment
                </span>
                Schedule job
              </span>
            ) : (
              <Link
                href="/dashboard/jobs"
                role="menuitem"
                className={menuItemClass}
                onClick={() => setOpen(false)}
              >
                <span className="material-symbols-outlined text-[18px] text-primary">
                  assignment
                </span>
                Schedule job
              </Link>
            )
          ) : isCancelled ? (
            <span
              role="menuitem"
              className={disabledMenuItemClass}
              title="Cancelled quotations cannot be scheduled"
            >
              <span className="material-symbols-outlined text-[18px] text-outline">
                event_busy
              </span>
              Schedule job
            </span>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled
              className={menuItemClass}
              title="Complete the request before scheduling"
            >
              <span className="material-symbols-outlined text-[18px] text-outline">
                event
              </span>
              Schedule job
            </button>
          )}
          {!canIssueInvoice ? (
            <span
              role="menuitem"
              className={disabledMenuItemClass}
              title={
                isCancelled
                  ? "Cancelled quotations cannot be invoiced"
                  : hasInvoice
                    ? "Invoice already issued for this quotation"
                    : quotation.status !== "sent"
                      ? "Send the quotation before issuing an invoice"
                      : awaitingCustomerTitle
              }
            >
              <span className="material-symbols-outlined text-[18px] text-outline">
                receipt_long
              </span>
              Issue invoice
            </span>
          ) : (
            <Link
              href={invoiceHref}
              role="menuitem"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                receipt_long
              </span>
              Issue invoice
            </Link>
          )}
          {canCancel ? (
            <button
              type="button"
              role="menuitem"
              className={`${menuItemClass} text-rose-700 hover:bg-rose-50`}
              onClick={() => {
                setOpen(false);
                onCancelQuotation();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-rose-600">
                cancel
              </span>
              Cancel quotation
            </button>
          ) : null}
          {isCancelled ? (
            <button
              type="button"
              role="menuitem"
              className={`${menuItemClass} text-primary hover:bg-primary/5`}
              onClick={() => {
                setOpen(false);
                onUndoCancel();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                undo
              </span>
              Undo cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QuotationCard({
  quotation,
  isPreviewOpen,
  onOpen,
  onBook,
  onCancel,
  onUndoCancel,
  timeZone,
}: {
  quotation: QuotationDetail;
  isPreviewOpen: boolean;
  onOpen: () => void;
  onBook: () => void;
  onCancel: () => void;
  onUndoCancel: () => void;
  timeZone?: string | null;
}) {
  const awaitingCustomer = quotationAwaitingCustomerAcceptance(quotation);
  const hasInvoice = quotationHasInvoice(quotation);
  const showFollowUpActions =
    canConvertQuotationToBooking(quotation) && !awaitingCustomer;
  const waitHref = `/dashboard/requests?request=${encodeURIComponent(quotation.inspectionRequestId)}&action=awaiting-decision`;

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
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
            {displayQuotationCode(quotation)}
          </span>
          <StatusPill status={quotation.status} />
          {hasInvoice ? <CompletedPill /> : null}
          {quotation.bookingStatus && !quotation.bookingId ? (
            <BookingStatusPill status={quotation.bookingStatus} />
          ) : null}
          <CustomerDecisionPill quotation={quotation} />
          <CreatedSourcePill source={quotation.createdSource} />
        </div>
        <QuotationCardMenu
          quotation={quotation}
          onScheduleBooking={onBook}
          onCancelQuotation={onCancel}
          onUndoCancel={onUndoCancel}
        />
      </div>
      <h4 className="font-display text-[16px] font-semibold text-on-surface">
        {quotation.customer.fullName || "Customer"}
      </h4>
      <p className="font-body text-[13px] text-on-surface-variant">
        Service: {quotation.serviceTitle || "Quotation"}
      </p>
      <p className="font-body text-[13px] text-on-surface-variant">
        {quotation.customer.phone}
      </p>
      <p className="font-body text-[12px] text-on-surface-variant">
        {formatAddress(quotation.address)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-outline-variant/40 pt-3">
        <span className="font-numeric text-[15px] font-semibold text-primary">
          {formatAud(quotation.finalPriceAud)}
        </span>
        <span className="font-body text-[11px] text-on-surface-variant">
          {formatWhen(quotation.createdAt, timeZone)}
        </span>
        {showFollowUpActions ? (
          <FollowUpActionButtons
            className="sm:ml-auto"
            onBook={onBook}
            waitHref={waitHref}
          />
        ) : quotation.bookingId ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary sm:ml-auto">
            <span className="material-symbols-outlined text-[12px] leading-none">
              assignment
            </span>
            {displayBookingCode({
              id: quotation.bookingId,
              bookingCode: quotation.bookingCode,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function QuotationPreviewDrawer({
  quotation,
  previewMode,
  linkedInspection,
  onClose,
  onPreviewModeChange,
  onBookingCreated,
  onQuotationDecided,
  onCancelQuotation,
  onUndoCancel,
  timeZone,
}: {
  quotation: QuotationDetail | null;
  previewMode: QuotationPreviewMode;
  linkedInspection: InspectionRequestDetail | null;
  onClose: () => void;
  onPreviewModeChange: (mode: QuotationPreviewMode) => void;
  onBookingCreated: (request: InspectionRequestDetail) => void;
  onQuotationDecided: (decision: "accepted" | "rejected") => void;
  onCancelQuotation: (quotation: QuotationDetail) => void;
  onUndoCancel: (quotation: QuotationDetail) => void;
  timeZone?: string | null;
}) {
  const open = quotation !== null;

  return (
    <AnimatePresence>
      {open && quotation ? (
        <motion.div
          key="quotation-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 overflow-hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            key="quotation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Quotation preview: ${displayQuotationCode(quotation)}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-full flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl will-change-transform sm:w-full sm:max-w-[640px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <QuotationPreviewContent
              quotation={quotation}
              previewMode={previewMode}
              linkedInspection={linkedInspection}
              onClose={onClose}
              onPreviewModeChange={onPreviewModeChange}
              onBookingCreated={onBookingCreated}
              onQuotationDecided={onQuotationDecided}
              onCancelQuotation={onCancelQuotation}
              onUndoCancel={onUndoCancel}
              timeZone={timeZone}
            />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function QuotationPreviewContent({
  quotation,
  previewMode,
  linkedInspection,
  onClose,
  onPreviewModeChange,
  onBookingCreated,
  onQuotationDecided,
  onCancelQuotation,
  onUndoCancel,
  timeZone,
}: {
  quotation: QuotationDetail;
  previewMode: QuotationPreviewMode;
  linkedInspection: InspectionRequestDetail | null;
  onClose: () => void;
  onPreviewModeChange: (mode: QuotationPreviewMode) => void;
  onBookingCreated: (request: InspectionRequestDetail) => void;
  onQuotationDecided: (decision: "accepted" | "rejected") => void;
  onCancelQuotation: (quotation: QuotationDetail) => void;
  onUndoCancel: (quotation: QuotationDetail) => void;
  timeZone?: string | null;
}) {
  const { user } = useAuth();
  const [pdfOpen, setPdfOpen] = useState(false);
  const [invoicePdfOpen, setInvoicePdfOpen] = useState(false);
  const [invoicePdfSource, setInvoicePdfSource] = useState<string | null>(null);
  const [invoicePdfLoading, setInvoicePdfLoading] = useState(false);
  const [invoicePdfError, setInvoicePdfError] = useState<string | null>(null);
  const title = quotation.serviceTitle || "Quotation";
  const downloadFilename = `quotation-${title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "bmspro"}.pdf`;
  const invoiceDownloadFilename = `${(quotation.invoiceCode ?? "invoice")
    .replace(/[^a-z0-9.\-]+/gi, "-")
    .toLowerCase()}.pdf`;

  const canConvert = canConvertQuotationToBooking(quotation);
  const hasInvoice = quotationHasInvoice(quotation);
  const jobLocked = quotationJobActionsLocked(quotation);
  const awaitingCustomer = quotationAwaitingCustomerAcceptance(quotation);
  const canCancel = canCancelQuotation(quotation);
  const isCancelled = quotation.status === "cancelled";
  const awaitingCustomerTitle =
    quotation.customerDecision === "rejected"
      ? "The customer rejected this quotation"
      : "Waiting for the customer to accept this quotation";
  const editDraftHref = `/dashboard/quotations/new?quotationId=${encodeURIComponent(quotation.id)}`;
  const hasFooterActions =
    previewMode === "review" &&
    (quotation.status === "sent" ||
      Boolean(quotation.pdfUrl) ||
      hasInvoice ||
      canCancel);

  function closeInvoicePdf() {
    setInvoicePdfOpen(false);
    if (invoicePdfSource?.startsWith("blob:")) {
      URL.revokeObjectURL(invoicePdfSource);
    }
    setInvoicePdfSource(null);
    setInvoicePdfError(null);
  }

  async function openInvoicePdf() {
    setInvoicePdfError(null);
    if (quotation.invoicePdfUrl) {
      setInvoicePdfSource(quotation.invoicePdfUrl);
      setInvoicePdfOpen(true);
      return;
    }
    if (!user || !quotation.invoiceId) {
      setInvoicePdfError("Could not open invoice PDF.");
      return;
    }

    setInvoicePdfLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/invoices/pdf?quotationId=${encodeURIComponent(quotation.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error("Could not load invoice PDF.");
      }
      const blob = await response.blob();
      setInvoicePdfSource(URL.createObjectURL(blob));
      setInvoicePdfOpen(true);
    } catch (error) {
      setInvoicePdfError(
        error instanceof Error
          ? error.message
          : "Could not open invoice PDF.",
      );
    } finally {
      setInvoicePdfLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            {previewMode === "convert_booking"
              ? "Create job"
              : "Quotation preview"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
              {displayQuotationCode(quotation)}
            </span>
            <StatusPill status={quotation.status} />
            {quotation.bookingStatus && !quotation.bookingId ? (
              <BookingStatusPill status={quotation.bookingStatus} />
            ) : null}
            <CustomerDecisionPill quotation={quotation} />
            <CreatedSourcePill source={quotation.createdSource} />
          </div>
          <h3 className="mt-2 font-display text-[20px] font-semibold text-on-surface">
            {title}
          </h3>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Sent {formatWhen(quotation.createdAt, timeZone)}
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

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3 sm:space-y-3 sm:px-5">
        {previewMode === "convert_booking" ? (
          <ConvertToBookingPanel
            inspectionRequestId={quotation.inspectionRequestId}
            minBookingDate={bookingMinDateFromInspection(
              linkedInspection,
              timeZone,
            )}
            initialStartTime={linkedInspection?.scheduledStartTime ?? "10:00"}
            initialEndTime={linkedInspection?.scheduledEndTime ?? "11:00"}
            onSuccess={onBookingCreated}
            onCancel={() => onPreviewModeChange("review")}
          />
        ) : null}

        {previewMode === "review" && quotation.createdSource ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Source
            </p>
            <div className="mt-2">
              <CreatedSourcePill source={quotation.createdSource} />
            </div>
          </section>
        ) : null}

        {previewMode === "review" && quotation.status === "draft" ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
            <p className="font-body text-[12px] font-semibold text-amber-900">
              This quotation is saved as a draft.
            </p>
            <p className="mt-1 font-body text-[12px] leading-relaxed text-amber-800">
              Edit it to make changes, then send it to the customer when ready.
            </p>
            <Link
              href={editDraftHref}
              onClick={onClose}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[18px]">
                edit_square
              </span>
              Edit &amp; send draft
            </Link>
          </section>
        ) : null}

        {previewMode === "review" && isCancelled ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50/80 p-3">
            <p className="font-body text-[12px] font-semibold text-rose-900">
              This quotation has been cancelled.
            </p>
            <p className="mt-1 font-body text-[12px] leading-relaxed text-rose-800">
              Cancelled quotations are kept for reference only and cannot be
              edited, scheduled, or invoiced.
            </p>
            <button
              type="button"
              onClick={() => onUndoCancel(quotation)}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 py-2.5 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <span className="material-symbols-outlined text-[18px]">
                undo
              </span>
              Undo cancel
            </button>
          </section>
        ) : null}

        {previewMode === "review" ? (
        <>
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Customer
          </p>
          <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
            {quotation.customer.fullName}
          </p>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            {quotation.customer.phone}
            {quotation.customer.email ? ` · ${quotation.customer.email}` : ""}
          </p>
          <p className="mt-2 font-body text-[13px] text-on-surface">
            {formatAddress(quotation.address)}
          </p>
        </section>

        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Line items
          </p>
          <ul className="mt-2 space-y-1.5">
            {quotation.lineItems.map((item, index) => (
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
            <span className="font-numeric">{formatAud(quotation.subtotalAud)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2 font-body text-[14px] font-bold text-primary">
            <span>Final price</span>
            <span className="font-numeric">{formatAud(quotation.finalPriceAud)}</span>
          </div>
        </section>

        {quotation.notes ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-line font-body text-[13px] text-on-surface">
              {quotation.notes}
            </p>
          </section>
        ) : null}

        {quotation.bookingId ? (
          <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
              Linked job
            </p>
            <p className="mt-1 font-mono text-[13px] font-semibold text-primary">
              {displayBookingCode({
                id: quotation.bookingId,
                bookingCode: quotation.bookingCode,
              })}
            </p>
          </section>
        ) : null}

        {hasInvoice ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              Linked invoice
            </p>
            <p className="mt-1 font-mono text-[13px] font-semibold text-emerald-900">
              {quotation.invoiceCode ?? "Invoice issued"}
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Linked visit
          </p>
          <Link
            href={`/dashboard/requests?request=${quotation.inspectionRequestId}`}
            onClick={onClose}
            className="mt-2 flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">
              event_available
            </span>
            <InspectionRequestCode
              request={{ id: quotation.inspectionRequestId }}
              className="font-mono text-[13px] font-semibold text-primary"
            />
          </Link>
        </section>

        {hasFooterActions ? (
          <footer className="space-y-2 border-t border-outline-variant/40 pt-3">
            {awaitingCustomer && quotation.status === "sent" ? (
              <div
                className={`flex items-start gap-2 rounded-xl border p-3 ${
                  quotation.customerDecision === "rejected"
                    ? "border-rose-200 bg-rose-50/80"
                    : "border-amber-200 bg-amber-50/80"
                }`}
              >
                <span
                  className={`material-symbols-outlined shrink-0 text-[18px] ${
                    quotation.customerDecision === "rejected"
                      ? "text-rose-600"
                      : "text-amber-600"
                  }`}
                >
                  {quotation.customerDecision === "rejected"
                    ? "cancel"
                    : "hourglass_top"}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-body text-[12px] font-semibold ${
                      quotation.customerDecision === "rejected"
                        ? "text-rose-800"
                        : "text-amber-800"
                    }`}
                  >
                    {quotation.customerDecision === "rejected"
                      ? "The customer rejected this quotation, so it cannot be converted into a job or an invoice."
                      : "Waiting for the customer to accept this quotation. Scheduling a job and issuing an invoice unlock once they accept."}
                  </p>
                  <QuotationOwnerDecisionButtons
                    className="mt-2.5"
                    quotationId={quotation.id}
                    status={quotation.status}
                    bookingId={quotation.bookingId}
                    customerDecision={quotation.customerDecision}
                    onDecided={onQuotationDecided}
                  />
                </div>
              </div>
            ) : null}
            {quotation.status === "sent" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {quotation.bookingId ? (
                  jobLocked ? (
                    <span
                      className={disabledActionClass}
                      title="Job completed and invoice already issued"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        assignment
                      </span>
                      View scheduled job
                    </span>
                  ) : (
                    <Link
                      href="/dashboard/jobs"
                      onClick={onClose}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 font-body text-[14px] font-semibold text-primary transition-colors hover:bg-primary/10"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        assignment
                      </span>
                      View scheduled job
                    </Link>
                  )
                ) : canConvert ? (
                  <button
                    type="button"
                    disabled={jobLocked || awaitingCustomer}
                    title={
                      jobLocked
                        ? "Job completed and invoice already issued"
                        : awaitingCustomer
                          ? awaitingCustomerTitle
                          : undefined
                    }
                    onClick={() => {
                      if (jobLocked || awaitingCustomer) return;
                      onPreviewModeChange("convert_booking");
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-body text-[14px] font-semibold transition-colors ${
                      jobLocked || awaitingCustomer
                        ? "cursor-not-allowed bg-primary/40 text-on-primary/70"
                        : "bg-primary text-on-primary hover:bg-primary/90"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      event
                    </span>
                    Schedule job
                  </button>
                ) : null}
                {hasInvoice || awaitingCustomer ? (
                  <span
                    className={disabledActionClass}
                    title={
                      hasInvoice
                        ? "Invoice already issued for this quotation"
                        : awaitingCustomerTitle
                    }
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      receipt_long
                    </span>
                    Issue invoice
                  </span>
                ) : (
                  <Link
                    href={`/dashboard/invoices?quotation=${encodeURIComponent(quotation.id)}`}
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-3 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      receipt_long
                    </span>
                    Issue invoice
                  </Link>
                )}
              </div>
            ) : null}

            {quotation.pdfUrl || hasInvoice ? (
              <div
                className={`grid gap-2 ${
                  quotation.pdfUrl && hasInvoice
                    ? "grid-cols-1 sm:grid-cols-2"
                    : "grid-cols-1"
                }`}
              >
                {quotation.pdfUrl ? (
                  <button
                    type="button"
                    onClick={() => setPdfOpen(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/60 bg-white px-4 py-3 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      picture_as_pdf
                    </span>
                    View quotation PDF
                  </button>
                ) : null}
                {hasInvoice ? (
                  <button
                    type="button"
                    onClick={() => void openInvoicePdf()}
                    disabled={invoicePdfLoading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-body text-[14px] font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        invoicePdfLoading ? "animate-spin" : ""
                      }`}
                    >
                      {invoicePdfLoading ? "progress_activity" : "receipt_long"}
                    </span>
                    {invoicePdfLoading ? "Loading invoice…" : "View invoice PDF"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {invoicePdfError ? (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
              >
                {invoicePdfError}
              </p>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                onClick={() => onCancelQuotation(quotation)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[14px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
              >
                <span className="material-symbols-outlined text-[20px]">
                  cancel
                </span>
                Cancel quotation
              </button>
            ) : null}
          </footer>
        ) : null}
        </>
        ) : null}
      </div>

      {quotation.pdfUrl ? (
        <QuotationPdfViewerModal
          open={pdfOpen}
          onClose={() => setPdfOpen(false)}
          pdfUrl={quotation.pdfUrl}
          title={title}
          downloadFilename={downloadFilename}
        />
      ) : null}
      {invoicePdfSource ? (
        <QuotationPdfViewerModal
          open={invoicePdfOpen}
          onClose={closeInvoicePdf}
          pdfUrl={invoicePdfSource}
          title={`Invoice — ${quotation.invoiceCode ?? title}`}
          downloadFilename={invoiceDownloadFilename}
        />
      ) : null}
    </div>
  );
}

function CancelQuotationConfirmModal({
  quotation,
  isLoading,
  onClose,
  onConfirm,
}: {
  quotation: QuotationDetail | null;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = quotation !== null;

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isLoading) onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, isLoading, onClose]);

  if (!quotation) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        disabled={isLoading}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-quotation-title"
        aria-describedby="cancel-quotation-desc"
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-200">
            <span className="material-symbols-outlined material-symbols-filled text-[28px]">
              cancel
            </span>
          </div>
          <h2
            id="cancel-quotation-title"
            className="font-display text-headline-sm font-semibold text-on-surface"
          >
            Cancel this quotation?
          </h2>
          <div
            id="cancel-quotation-desc"
            className="mt-2 space-y-2 font-body text-body-md text-on-surface-variant"
          >
            <p>
              {displayQuotationCode(quotation)} for{" "}
              <span className="font-semibold text-on-surface">
                {quotation.customer.fullName || "this customer"}
              </span>{" "}
              will move to the Cancelled tab.
            </p>
            <p>
              It will be kept for reference, but cannot be edited, scheduled,
              or invoiced after cancellation.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex h-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            Keep quotation
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-rose-600 px-5 font-body text-[14px] font-semibold text-white transition-all hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Cancelling...
              </>
            ) : (
              "Yes, cancel quotation"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuotationsBoard() {
  const { user, status: authStatus } = useAuth();
  const profile = useBusinessProfile();
  const { requests: inspectionRequests } = useInspectionRequests();
  const [quotations, setQuotations] = useState<QuotationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] =
    useState<QuotationPreviewMode>("review");
  const [filter, setFilter] = useState<QuotationFilter>("pending");
  const [cancelTarget, setCancelTarget] = useState<QuotationDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
      const response = await fetch("/api/quotations", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        quotations?: QuotationDetail[];
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not load quotations.");
      }
      setQuotations(data.quotations ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load quotations.",
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

  const selected = useMemo(
    () => quotations.find((quotation) => quotation.id === selectedId) ?? null,
    [quotations, selectedId],
  );

  const counts = useMemo(
    () => ({
      all: quotations.length,
      pending: quotations.filter(isPendingQuotation).length,
      completed: quotations.filter(isCompletedQuotation).length,
      draft: quotations.filter(
        (quotation) =>
          quotation.status === "draft" && !isCompletedQuotation(quotation),
      )
        .length,
      sent: quotations.filter(
        (quotation) =>
          quotation.status === "sent" && !isCompletedQuotation(quotation),
      )
        .length,
      cancelled: quotations.filter(
        (quotation) => quotation.status === "cancelled",
      ).length,
    }),
    [quotations],
  );

  const visibleQuotations = useMemo(
    () => {
      if (filter === "all") return quotations;
      if (filter === "pending") {
        return quotations.filter(isPendingQuotation);
      }
      if (filter === "completed") {
        return quotations.filter(isCompletedQuotation);
      }
      if (filter === "cancelled") {
        return quotations.filter((quotation) => quotation.status === filter);
      }
      return quotations.filter(
        (quotation) =>
          quotation.status === filter && !isCompletedQuotation(quotation),
      );
    },
    [filter, quotations],
  );

  const linkedInspection = useMemo(() => {
    if (!selected) return null;
    return (
      inspectionRequests.find(
        (request) => request.id === selected.inspectionRequestId,
      ) ?? null
    );
  }, [inspectionRequests, selected]);

  function handleOpenQuotation(id: string) {
    setSelectedId(id);
    setPreviewMode("review");
  }

  function handleStartConvertBooking(id: string) {
    setSelectedId(id);
    setPreviewMode("convert_booking");
  }

  function handleBookingCreated(request: InspectionRequestDetail) {
    setQuotations((prev) =>
      prev.map((quotation) => {
        if (quotation.inspectionRequestId !== request.id) return quotation;
        return {
          ...quotation,
          bookingId: request.bookingId,
          bookingCode: request.bookingCode,
          bookingStatus: request.bookingStatus,
          inspectionRequestStatus: request.status,
        };
      }),
    );
    setPreviewMode("review");
  }

  function handleQuotationDecided(decision: "accepted" | "rejected") {
    if (!selectedId) return;
    setQuotations((prev) =>
      prev.map((quotation) =>
        quotation.id === selectedId
          ? {
              ...quotation,
              customerDecision: decision,
              customerDecisionAt: Date.now(),
            }
          : quotation,
      ),
    );
  }

  async function confirmCancelQuotation() {
    if (!user || !cancelTarget) return;
    setCancelling(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/quotations/${cancelTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        quotation?: QuotationDetail;
      };
      if (!response.ok || !data.ok || !data.quotation) {
        throw new Error(data.error ?? "Could not cancel quotation.");
      }
      setQuotations((prev) =>
        prev.map((entry) =>
          entry.id === data.quotation!.id ? data.quotation! : entry,
        ),
      );
      setPreviewMode("review");
      setFilter("cancelled");
      setCancelTarget(null);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel quotation.",
      );
    } finally {
      setCancelling(false);
    }
  }

  async function handleUndoCancel(quotation: QuotationDetail) {
    if (!user) return;
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/quotations/${quotation.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "undo_cancel" }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        quotation?: QuotationDetail;
      };
      if (!response.ok || !data.ok || !data.quotation) {
        throw new Error(data.error ?? "Could not restore quotation.");
      }
      setQuotations((prev) =>
        prev.map((entry) =>
          entry.id === data.quotation!.id ? data.quotation! : entry,
        ),
      );
      setFilter(data.quotation.status);
      setPreviewMode("review");
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Could not restore quotation.",
      );
    }
  }

  function handleClosePreview() {
    setSelectedId(null);
    setPreviewMode("review");
  }

  if (authStatus === "loading" || loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((idx) => (
          <div
            key={idx}
            className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
      >
        {error}
      </div>
    );
  }

  if (quotations.length === 0) {
    return (
      <>
        <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
          <span className="material-symbols-outlined text-[40px] text-outline-variant">
            request_quote
          </span>
          <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
            No quotations yet
          </p>
          <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
            Create a quotation directly here, or send one from a completed
            request.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/quotations/new?fromRequests=1"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-5 py-2.5 font-body text-[14px] font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              <span className="material-symbols-outlined text-[20px]">
                assignment
              </span>
              From request
            </Link>
            <Link
              href="/dashboard/quotations/new"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              New quotation
            </Link>
            <Link
              href="/dashboard/requests"
              className="inline-flex items-center gap-2 rounded-xl border border-outline-variant px-5 py-2.5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px]">
                event_available
              </span>
              Requests
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-body text-[12px] text-on-surface-variant">
          {counts.pending} pending · {counts.completed} completed · tap a card
          to open the side preview
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard/quotations/new?fromRequests=1"
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[18px]">
              assignment
            </span>
            From request
          </Link>
          <Link
            href="/dashboard/quotations/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New quotation
          </Link>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-outline-variant/60 bg-surface-container-low p-1">
        {QUOTATION_TABS.map((tab) => {
          const selectedTab = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-body text-[12px] font-bold transition-colors ${
                selectedTab
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  selectedTab
                    ? "bg-on-primary/15 text-on-primary"
                    : "bg-surface-container-lowest text-on-surface-variant"
                }`}
              >
                {counts[tab.id]}
              </span>
            </button>
          );
        })}
      </div>

      {visibleQuotations.length > 0 ? (
        <ul className="space-y-3">
          {visibleQuotations.map((quotation) => (
            <li key={quotation.id}>
              <QuotationCard
                quotation={quotation}
                isPreviewOpen={selectedId === quotation.id}
                onOpen={() => handleOpenQuotation(quotation.id)}
                onBook={() => handleStartConvertBooking(quotation.id)}
                onCancel={() => setCancelTarget(quotation)}
                onUndoCancel={() => void handleUndoCancel(quotation)}
                timeZone={timeZone}
              />
            </li>
          ))}
        </ul>
      ) : (
        <section className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-5 py-8 text-center">
          <p className="font-display text-[17px] font-semibold text-on-surface">
            No{" "}
            {filter === "all"
              ? ""
              : `${quotationFilterLabel(filter).toLowerCase()} `}
            quotations
          </p>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            Quotations for this tab will appear here.
          </p>
        </section>
      )}

      <QuotationPreviewDrawer
        quotation={selected}
        previewMode={previewMode}
        linkedInspection={linkedInspection}
        onClose={handleClosePreview}
        onPreviewModeChange={setPreviewMode}
        onBookingCreated={handleBookingCreated}
        onQuotationDecided={handleQuotationDecided}
        onCancelQuotation={setCancelTarget}
        onUndoCancel={(quotation) => void handleUndoCancel(quotation)}
        timeZone={timeZone}
      />
      <CancelQuotationConfirmModal
        quotation={cancelTarget}
        isLoading={cancelling}
        onClose={() => {
          if (!cancelling) setCancelTarget(null);
        }}
        onConfirm={() => void confirmCancelQuotation()}
      />
    </>
  );
}
