"use client";

import {
  bookingMinDateFromInspection,
  canConvertQuotationToBooking,
  ConvertToBookingPanel,
} from "@/components/convert-to-booking-panel";
import { FollowUpActionButtons } from "@/components/follow-up-action-buttons";
import { InspectionRequestCode } from "@/components/inspection-request-code";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import { useAuth } from "@/lib/auth/auth-context";
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
import type { QuotationDetail } from "@/lib/quotations/types";
import { displayBookingCode, displayQuotationCode } from "@/lib/reference-codes";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatAud(value: number | null): string {
  if (value == null) return "—";
  return `Aus $${value.toFixed(2)}`;
}

function formatWhen(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type QuotationPreviewMode = "review" | "convert_booking";

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

function QuotationCardMenu({
  quotation,
  onScheduleBooking,
}: {
  quotation: QuotationDetail;
  onScheduleBooking: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canSchedule = canConvertQuotationToBooking(quotation);
  const hasBooking = Boolean(quotation.bookingId);
  const invoiceHref = `/dashboard/invoices?quotation=${encodeURIComponent(quotation.id)}`;

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
          {canSchedule ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setOpen(false);
                onScheduleBooking();
              }}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                event
              </span>
              Schedule booking
            </button>
          ) : hasBooking ? (
            <Link
              href="/dashboard/bookings"
              role="menuitem"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <span className="material-symbols-outlined text-[18px] text-primary">
                assignment
              </span>
              Schedule booking
            </Link>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled
              className={menuItemClass}
              title="Complete the inspection visit before scheduling"
            >
              <span className="material-symbols-outlined text-[18px] text-outline">
                event
              </span>
              Schedule booking
            </button>
          )}
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
}: {
  quotation: QuotationDetail;
  isPreviewOpen: boolean;
  onOpen: () => void;
  onBook: () => void;
}) {
  const showFollowUpActions = canConvertQuotationToBooking(quotation);
  const waitHref = `/dashboard/inspection-visits?request=${encodeURIComponent(quotation.inspectionRequestId)}&action=awaiting-decision`;

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
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-sky-700">
            {quotation.status}
          </span>
          {quotation.bookingStatus && !quotation.bookingId ? (
            <BookingStatusPill status={quotation.bookingStatus} />
          ) : null}
          <CreatedSourcePill source={quotation.createdSource} />
        </div>
        <QuotationCardMenu
          quotation={quotation}
          onScheduleBooking={onBook}
        />
      </div>
      <h4 className="font-display text-[16px] font-semibold text-on-surface">
        {quotation.serviceTitle || "Quotation"}
      </h4>
      <p className="font-body text-[13px] text-on-surface-variant">
        {quotation.customer.fullName} · {quotation.customer.phone}
      </p>
      <p className="font-body text-[12px] text-on-surface-variant">
        {formatAddress(quotation.address)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-outline-variant/40 pt-3">
        <span className="font-numeric text-[15px] font-semibold text-primary">
          {formatAud(quotation.finalPriceAud)}
        </span>
        <span className="font-body text-[11px] text-on-surface-variant">
          {formatWhen(quotation.createdAt)}
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
}: {
  quotation: QuotationDetail | null;
  previewMode: QuotationPreviewMode;
  linkedInspection: InspectionRequestDetail | null;
  onClose: () => void;
  onPreviewModeChange: (mode: QuotationPreviewMode) => void;
  onBookingCreated: (request: InspectionRequestDetail) => void;
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
}: {
  quotation: QuotationDetail;
  previewMode: QuotationPreviewMode;
  linkedInspection: InspectionRequestDetail | null;
  onClose: () => void;
  onPreviewModeChange: (mode: QuotationPreviewMode) => void;
  onBookingCreated: (request: InspectionRequestDetail) => void;
}) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const title = quotation.serviceTitle || "Quotation";
  const downloadFilename = `quotation-${title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "bmspro"}.pdf`;

  const hasFooterActions =
    previewMode === "review" &&
    (quotation.status === "sent" || Boolean(quotation.pdfUrl));
  const canConvert = canConvertQuotationToBooking(quotation);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            {previewMode === "convert_booking"
              ? "Create booking"
              : "Quotation preview"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
              {displayQuotationCode(quotation)}
            </span>
            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-sky-700">
              {quotation.status}
            </span>
            {quotation.bookingStatus && !quotation.bookingId ? (
              <BookingStatusPill status={quotation.bookingStatus} />
            ) : null}
            <CreatedSourcePill source={quotation.createdSource} />
          </div>
          <h3 className="mt-2 font-display text-[20px] font-semibold text-on-surface">
            {title}
          </h3>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Sent {formatWhen(quotation.createdAt)}
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
            minBookingDate={bookingMinDateFromInspection(linkedInspection)}
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
              Linked booking
            </p>
            <p className="mt-1 font-mono text-[13px] font-semibold text-primary">
              {displayBookingCode({
                id: quotation.bookingId,
                bookingCode: quotation.bookingCode,
              })}
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Linked visit
          </p>
          <Link
            href={`/dashboard/inspection-visits?request=${quotation.inspectionRequestId}`}
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
            {quotation.status === "sent" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {quotation.bookingId ? (
                  <Link
                    href="/dashboard/bookings"
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 font-body text-[14px] font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      assignment
                    </span>
                    View scheduled job
                  </Link>
                ) : canConvert ? (
                  <button
                    type="button"
                    onClick={() => onPreviewModeChange("convert_booking")}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      event
                    </span>
                    Schedule job
                  </button>
                ) : null}
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
              </div>
            ) : null}

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
    </div>
  );
}

export function QuotationsBoard() {
  const { user, status: authStatus } = useAuth();
  const { requests: inspectionRequests } = useInspectionRequests();
  const [quotations, setQuotations] = useState<QuotationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] =
    useState<QuotationPreviewMode>("review");

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
    void load();
  }, [load]);

  const selected = useMemo(
    () => quotations.find((quotation) => quotation.id === selectedId) ?? null,
    [quotations, selectedId],
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
            inspection visit.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/quotations/new"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              New quotation
            </Link>
            <Link
              href="/dashboard/inspection-visits"
              className="inline-flex items-center gap-2 rounded-xl border border-outline-variant px-5 py-2.5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px]">
                event_available
              </span>
              Inspection visits
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
          {quotations.length} quotation{quotations.length === 1 ? "" : "s"} · tap
          a card to open the side preview
        </p>
        <Link
          href="/dashboard/quotations/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          New quotation
        </Link>
      </div>
      <ul className="space-y-3">
        {quotations.map((quotation) => (
          <li key={quotation.id}>
            <QuotationCard
              quotation={quotation}
              isPreviewOpen={selectedId === quotation.id}
              onOpen={() => handleOpenQuotation(quotation.id)}
              onBook={() => handleStartConvertBooking(quotation.id)}
            />
          </li>
        ))}
      </ul>

      <QuotationPreviewDrawer
        quotation={selected}
        previewMode={previewMode}
        linkedInspection={linkedInspection}
        onClose={handleClosePreview}
        onPreviewModeChange={setPreviewMode}
        onBookingCreated={handleBookingCreated}
      />
    </>
  );
}
