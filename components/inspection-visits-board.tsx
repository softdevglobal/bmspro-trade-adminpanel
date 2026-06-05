"use client";

import {
  SlotDayPicker,
  buildBlockedComboSet,
  slotComboKey,
  todayIso,
} from "@/components/booking-slot-date-picker";
import { AddInspectionModal } from "@/components/add-inspection-modal";
import { ConvertToBookingPanel } from "@/components/convert-to-booking-panel";
import { FollowUpActionButtons } from "@/components/follow-up-action-buttons";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import { useAuth } from "@/lib/auth/auth-context";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONE,
  type BookingDetail,
  type BookingStatus,
} from "@/lib/bookings/types";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import {
  formatAddress,
  formatBudgetAud,
  formatClockTime,
  formatSlotDate,
  formatVisitWindow,
  isClockTime,
  CREATED_SOURCE_LABELS,
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT_LABELS,
  TIME_RANGES,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { InspectionRequestCode } from "@/components/inspection-request-code";
import {
  displayBookingCode,
  displayQuotationCode,
} from "@/lib/reference-codes";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type StaffSummary = {
  id: string;
  fullName: string;
  email: string;
  staffType: string;
};

function CreatedSourcePill({
  source,
}: {
  source: InspectionRequestDetail["createdSource"];
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

function staffAvatarUrl(member: {
  id: string;
  fullName: string;
  email: string;
}): string {
  const seed = encodeURIComponent(member.id || member.email || member.fullName);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

type StatusFilter = "all" | InspectionRequestStatus;

type DrawerMode =
  | "review"
  | "accept"
  | "set_time"
  | "propose"
  | "assign"
  | "cancel"
  | "convert_booking"
  | "awaiting_decision";

const STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending:
    "bg-amber-50 text-amber-700 border border-amber-200",
  owner_proposed:
    "bg-violet-50 text-violet-700 border border-violet-200",
  scheduled:
    "bg-emerald-50 text-emerald-700 border border-emerald-200",
  awaiting_decision:
    "bg-orange-50 text-orange-800 border border-orange-200",
  cancelled:
    "bg-stone-100 text-stone-600 border border-stone-200",
  completed:
    "bg-sky-50 text-sky-700 border border-sky-200",
};

const FILTER_TABS: { id: StatusFilter; label: string; shortLabel: string }[] = [
  { id: "all", label: "All", shortLabel: "All" },
  { id: "pending", label: "Pending", shortLabel: "Pending" },
  {
    id: "owner_proposed",
    label: "Awaiting customer",
    shortLabel: "Awaiting",
  },
  { id: "scheduled", label: "Scheduled", shortLabel: "Scheduled" },
  {
    id: "awaiting_decision",
    label: "Awaiting decision",
    shortLabel: "Decision",
  },
  { id: "completed", label: "Completed", shortLabel: "Done" },
  { id: "cancelled", label: "Cancelled", shortLabel: "Cancelled" },
];

function BookingStatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${BOOKING_STATUS_TONE[status]}`}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

function canFollowUpAfterQuotation(request: InspectionRequestDetail): boolean {
  return (
    !!request.quotation &&
    !request.bookingId &&
    (request.status === "completed" || request.status === "awaiting_decision")
  );
}

export function InspectionVisitsBoard() {
  const { user, status: authStatus } = useAuth();
  const {
    requests,
    loading: requestsLoading,
    error: requestsError,
  } = useInspectionRequests();
  const { staff, reload: reloadStaff } = useBusinessStaffSummary();
  const [requestsLocal, setRequestsLocal] = useState<InspectionRequestDetail[]>(
    [],
  );
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpenMode, setDrawerOpenMode] = useState<DrawerMode | null>(null);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [pendingDrawerMode, setPendingDrawerMode] = useState<DrawerMode | null>(
    null,
  );
  const [addModalOpen, setAddModalOpen] = useState(false);

  useEffect(() => {
    setRequestsLocal(requests);
  }, [requests]);

  const isLoading = requestsLoading;
  const loadError = requestsError;
  const boardRequests = requestsLocal;

  const filtered = useMemo(() => {
    if (filter === "all") return boardRequests;
    return boardRequests.filter((req) => req.status === filter);
  }, [boardRequests, filter]);

  const counts = useMemo(() => {
    const map: Record<StatusFilter, number> = {
      all: boardRequests.length,
      pending: 0,
      owner_proposed: 0,
      scheduled: 0,
      awaiting_decision: 0,
      cancelled: 0,
      completed: 0,
    };
    for (const req of boardRequests) {
      map[req.status] += 1;
    }
    return map;
  }, [boardRequests]);

  // Open a specific request when arriving from a notification (URL ?request=
  // on first load, or a custom event when already on this page).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("request");
    const action = params.get("action");
    if (fromUrl) setPendingOpenId(fromUrl);
    if (action === "schedule-job") {
      setPendingDrawerMode("convert_booking");
    }
    if (action === "awaiting-decision") {
      setPendingDrawerMode("awaiting_decision");
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail) setPendingOpenId(detail);
    };
    window.addEventListener("bmspt:open-inspection-request", handler);
    return () =>
      window.removeEventListener("bmspt:open-inspection-request", handler);
  }, []);

  useEffect(() => {
    if (!pendingOpenId) return;
    if (boardRequests.some((req) => req.id === pendingOpenId)) {
      setSelectedId(pendingOpenId);
      if (pendingDrawerMode) {
        setDrawerOpenMode(pendingDrawerMode);
        setPendingDrawerMode(null);
      }
      setPendingOpenId(null);
    }
  }, [pendingOpenId, pendingDrawerMode, boardRequests]);

  const selected = useMemo(
    () => boardRequests.find((req) => req.id === selectedId) ?? null,
    [boardRequests, selectedId],
  );

  function handleUpdated(next: InspectionRequestDetail) {
    setRequestsLocal((prev) =>
      prev.map((req) => (req.id === next.id ? next : req)),
    );
  }

  if (authStatus === "loading") {
    return <BoardSkeleton />;
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 sm:space-y-5">
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:gap-2"
          role="tablist"
          aria-label="Filter inspection requests"
        >
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 font-body text-[12px] font-semibold transition-all sm:w-auto sm:rounded-full sm:px-4 sm:py-2 sm:text-[13px] ${
                filter === tab.id
                  ? "bg-primary text-on-primary shadow-sm"
                  : "border border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant hover:border-primary/50 hover:text-primary"
              }`}
            >
              <span className="truncate sm:hidden">{tab.shortLabel}</span>
              <span className="hidden truncate sm:inline">{tab.label}</span>
              <span
                className={`inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                  filter === tab.id ? "bg-black/15" : "bg-black/10"
                }`}
              >
                {counts[tab.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">add</span>
            Add Inspection
          </button>
          <button
            type="button"
            onClick={() => void reloadStaff()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container sm:w-auto"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
        >
          {loadError}
        </div>
      ) : null}

      {isLoading ? (
        <BoardSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="space-y-3">
          {filtered.map((req) => (
            <li key={req.id}>
              <RequestCard
                request={req}
                onOpen={() => {
                  setDrawerOpenMode(null);
                  setSelectedId(req.id);
                }}
                onCreateBooking={() => {
                  setDrawerOpenMode("convert_booking");
                  setSelectedId(req.id);
                }}
                onAwaitingDecision={() => {
                  setDrawerOpenMode("awaiting_decision");
                  setSelectedId(req.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <RequestDetailDrawer
        request={selected}
        staff={staff}
        initialMode={drawerOpenMode}
        onInitialModeConsumed={() => setDrawerOpenMode(null)}
        onClose={() => {
          setSelectedId(null);
          setDrawerOpenMode(null);
        }}
        onUpdated={handleUpdated}
      />

      <AddInspectionModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreated={(requestId) => {
          if (requestId) setSelectedId(requestId);
        }}
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((idx) => (
        <div
          key={idx}
          className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
        />
      ))}
    </div>
  );
}

function EmptyState({ filter }: { filter: StatusFilter }) {
  return (
    <div className="w-full min-w-0 rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-6 text-center sm:rounded-2xl sm:p-10">
      <span className="material-symbols-outlined text-[36px] text-outline-variant">
        event_available
      </span>
      <p className="mt-3 font-display text-[18px] font-semibold text-on-surface">
        {filter === "all"
          ? "No inspection requests yet"
          : "Nothing in this view"}
      </p>
      <p className="mt-1 font-body text-body-md text-on-surface-variant">
        {filter === "all"
          ? "Customer requests from your booking page will land here."
          : "Switch filters to see other requests."}
      </p>
    </div>
  );
}

function RequestCard({
  request,
  onOpen,
  onCreateBooking,
  onAwaitingDecision,
}: {
  request: InspectionRequestDetail;
  onOpen: () => void;
  onCreateBooking: () => void;
  onAwaitingDecision: () => void;
}) {
  const title =
    request.requestType === "existing_service"
      ? request.serviceName ?? "Existing service"
      : request.customRequest?.title ?? "Custom quotation request";

  const subtitle =
    request.requestType === "existing_service"
      ? request.serviceBusinessType ?? "Service request"
      : "Custom quotation request";

  const created = request.createdAt
    ? new Date(request.createdAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  const showScheduledOnly =
    Boolean(request.scheduledSlot) &&
    (request.status === "scheduled" || request.status === "completed");

  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const showPostQuoteActions = canFollowUpAfterQuotation(request);
  const hasLinkedBooking = Boolean(request.bookingId);

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
      className="group flex w-full min-w-0 max-w-full cursor-pointer flex-col gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md sm:p-5 sm:hover:-translate-y-0.5"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${STATUS_TONE[request.status]}`}
            >
              {STATUS_LABELS[request.status]}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant/60 bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[12px] leading-none text-primary">
                {request.requestType === "existing_service"
                  ? "format_list_bulleted"
                  : "request_quote"}
              </span>
              {subtitle}
            </span>
            <CreatedSourcePill source={request.createdSource} />
          </div>
          <h4 className="mt-2 truncate font-display text-[16px] font-semibold text-on-surface">
            {title}
          </h4>
          <p className="mt-1">
            <InspectionRequestCode
              request={request}
              className="inline-flex items-baseline gap-px font-mono text-[11px] font-semibold text-on-surface-variant"
            />
          </p>
          <p className="mt-0.5 truncate font-body text-[13px] text-on-surface-variant">
            {request.customer.fullName} · {request.customer.phone}
          </p>
          <p className="truncate font-body text-[12px] text-on-surface-variant">
            {formatAddress(request.address)}
          </p>
        </div>

        <div className="shrink-0 sm:text-right">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Submitted
          </p>
          <p className="font-body text-[13px] font-semibold text-on-surface">
            {created}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-outline-variant/40 pt-3">
        {showScheduledOnly && request.scheduledSlot ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
          >
            <span className="material-symbols-outlined text-[12px] leading-none">
              event_available
            </span>
            {formatSlotDate(request.scheduledSlot.date)} ·{" "}
            {TIME_RANGE_SHORT_LABELS[request.scheduledSlot.timeRange]}
            {visitWindow ? ` · ${visitWindow}` : null}
          </span>
        ) : (
          <>
            {request.preferredSlots.slice(0, 3).map((slot, idx) => (
              <SlotPill
                key={`${slot.date}-${slot.timeRange}-${idx}`}
                slot={slot}
                tone="customer"
              />
            ))}
            {request.scheduledSlot ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <span className="material-symbols-outlined text-[12px] leading-none">
                  event_available
                </span>
                Scheduled · {formatSlotDate(request.scheduledSlot.date)} ·{" "}
                {TIME_RANGE_SHORT_LABELS[request.scheduledSlot.timeRange]}
              </span>
            ) : null}
          </>
        )}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
          {request.assignedTo ? (
            <span
              className="inline-flex max-w-full shrink-0 items-center gap-1 font-body text-[11px] text-on-surface-variant"
              aria-label={
                request.assignedTo.type === "owner"
                  ? "Assigned to you"
                  : `Assigned to ${request.assignedTo.name}`
              }
            >
              <span className="material-symbols-outlined text-[12px] leading-none text-primary">
                {request.assignedTo.type === "owner"
                  ? "verified_user"
                  : "person"}
              </span>
              <span className="truncate font-semibold text-primary">
                {request.assignedTo.type === "owner"
                  ? "Assigned to you"
                  : `Assigned to ${request.assignedTo.name}`}
              </span>
            </span>
          ) : null}
          {hasLinkedBooking ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary">
              <span className="material-symbols-outlined text-[12px] leading-none">
                assignment
              </span>
              {displayBookingCode({
                id: request.bookingId ?? "",
                bookingCode: request.bookingCode,
              })}
            </span>
          ) : null}
          {request.bookingStatus ? (
            <BookingStatusPill status={request.bookingStatus} />
          ) : null}
          {showPostQuoteActions ? (
            <div
              className={
                request.assignedTo || hasLinkedBooking || request.bookingStatus
                  ? "border-l border-outline-variant/50 pl-2"
                  : ""
              }
            >
              <FollowUpActionButtons
                onBook={onCreateBooking}
                onWait={onAwaitingDecision}
                showWait={request.status === "completed"}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SlotPill({
  slot,
  tone,
}: {
  slot: InspectionSlot;
  tone: "customer" | "owner";
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 font-body text-[10px] font-semibold sm:px-2.5 sm:text-[11px] ${
        tone === "customer"
          ? "border border-stone-200 bg-stone-50 text-on-surface"
          : "border border-violet-200 bg-violet-50 text-violet-700"
      }`}
    >
      <span className="material-symbols-outlined shrink-0 text-[12px] leading-none text-primary">
        event
      </span>
      <span className="truncate">
        {formatSlotDate(slot.date)} · {TIME_RANGE_SHORT_LABELS[slot.timeRange]}
      </span>
    </span>
  );
}

/* ==========================================================================
 * Detail drawer + actions
 * ========================================================================== */

function RequestDetailDrawer({
  request,
  staff,
  initialMode,
  onInitialModeConsumed,
  onClose,
  onUpdated,
}: {
  request: InspectionRequestDetail | null;
  staff: StaffSummary[];
  initialMode: DrawerMode | null;
  onInitialModeConsumed: () => void;
  onClose: () => void;
  onUpdated: (next: InspectionRequestDetail) => void;
}) {
  const open = request !== null;

  return (
    <AnimatePresence>
      {open && request ? (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 overflow-hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-full flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl will-change-transform sm:w-full sm:max-w-[640px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <DetailDrawerContent
              key={request.id}
              request={request}
              staff={staff}
              initialMode={initialMode}
              onInitialModeConsumed={onInitialModeConsumed}
              onClose={onClose}
              onUpdated={onUpdated}
            />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DrawerFooterAction({
  icon,
  label,
  onClick,
  disabled,
  variant = "secondary",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "success" | "danger";
}) {
  const styles = {
    primary:
      "border-transparent bg-primary text-on-primary shadow-sm hover:opacity-95",
    success:
      "border-emerald-600/30 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
    secondary:
      "border-outline-variant/60 bg-white text-on-surface hover:bg-surface-container",
    danger:
      "border-rose-200/80 bg-white text-rose-700 hover:bg-rose-50",
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 font-body text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    >
      <span className="material-symbols-outlined text-[15px] leading-none">{icon}</span>
      {label}
    </button>
  );
}

function DrawerReviewFooter({
  request,
  submitting,
  onAccept,
  onPropose,
  onSetTime,
  onAssign,
  onComplete,
  onCancel,
  onCreateBooking,
  onAwaitingDecision,
}: {
  request: InspectionRequestDetail;
  submitting: boolean;
  onAccept: () => void;
  onPropose: () => void;
  onSetTime: () => void;
  onAssign: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onCreateBooking: () => void;
  onAwaitingDecision: () => void;
}) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const followUp = canFollowUpAfterQuotation(request);

  if (request.quotation) {
    const headline =
      request.requestType === "existing_service"
        ? request.serviceName ?? "Quotation"
        : request.customRequest?.title ?? "Quotation";
    const pdfUrl = request.quotation.pdfUrl;
    const downloadFilename = `quotation-${headline
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "bmspro"}.pdf`;

    return (
      <div className="space-y-2 border-t border-outline-variant/40 pt-3">
        {pdfUrl ? (
          <>
            <DrawerFooterAction
              icon="picture_as_pdf"
              label="View quotation"
              variant={followUp ? "secondary" : "primary"}
              onClick={() => setPdfOpen(true)}
              disabled={submitting}
            />
            <QuotationPdfViewerModal
              open={pdfOpen}
              onClose={() => setPdfOpen(false)}
              pdfUrl={pdfUrl}
              title={headline}
              downloadFilename={downloadFilename}
            />
          </>
        ) : (
          <p className="rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 font-body text-[13px] text-on-surface-variant">
            Quotation sent — PDF is not available yet.
          </p>
        )}
        {followUp ? (
          <>
            <DrawerFooterAction
              icon="assignment"
              label="Create booking"
              variant="primary"
              onClick={onCreateBooking}
              disabled={submitting}
            />
            {request.status === "completed" ? (
              <DrawerFooterAction
                icon="pending_actions"
                label="Awaiting decision"
                onClick={onAwaitingDecision}
                disabled={submitting}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  const hasVisitWindow =
    !!request.scheduledStartTime || !!request.scheduledEndTime;

  return (
    <div className="border-t border-outline-variant/40 pt-4">
      {request.status === "scheduled" ? (
        <div className="space-y-3">
          {hasVisitWindow ? (
            <>
              <DrawerFooterAction
                icon={request.assignedTo ? "swap_horiz" : "person_add"}
                label={request.assignedTo ? "Reassign inspector" : "Assign inspector"}
                variant="primary"
                onClick={onAssign}
                disabled={submitting}
              />
              <div className="grid grid-cols-2 gap-2">
                <DrawerFooterAction
                  icon="schedule"
                  label="Edit time"
                  onClick={onSetTime}
                  disabled={submitting}
                />
                <DrawerFooterAction
                  icon="task_alt"
                  label="Mark done"
                  onClick={onComplete}
                  disabled={submitting}
                />
              </div>
            </>
          ) : (
            <DrawerFooterAction
              icon={request.assignedTo ? "swap_horiz" : "person_add"}
              label={request.assignedTo ? "Reassign inspector" : "Assign inspector"}
              variant="primary"
              onClick={onAssign}
              disabled={submitting}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <DrawerFooterAction
            icon="event_available"
            label="Accept a date"
            variant="primary"
            onClick={onAccept}
            disabled={submitting}
          />
          <DrawerFooterAction
            icon="edit_calendar"
            label="Propose new dates"
            onClick={onPropose}
            disabled={submitting}
          />
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[17px]">close</span>
        Cancel request
      </button>
    </div>
  );
}

function CompactRequestSummary({
  request,
  onShowFullDetails,
}: {
  request: InspectionRequestDetail;
  onShowFullDetails: () => void;
}) {
  const headline =
    request.requestType === "existing_service"
      ? request.serviceName ?? "Existing service"
      : request.customRequest?.title ?? "Custom quotation request";

  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low">
      <div className="space-y-1 px-3 py-3 sm:px-4">
        <p className="font-body text-[13px] font-semibold text-on-surface">
          {headline}
        </p>
        <p className="font-body text-[12px] text-on-surface-variant">
          {request.customer.fullName}
          {request.customer.phone ? ` · ${request.customer.phone}` : ""}
        </p>
        {request.scheduledSlot ? (
          <p className="flex items-start gap-1.5 pt-1 font-body text-[12px] font-semibold leading-snug text-emerald-800">
            <span className="material-symbols-outlined shrink-0 text-[16px]">
              event_available
            </span>
            <span className="min-w-0">
              {formatSlotDate(request.scheduledSlot.date)} ·{" "}
              {TIME_RANGE_LABELS[request.scheduledSlot.timeRange]}
              {formatVisitWindow(
                request.scheduledStartTime,
                request.scheduledEndTime,
              )
                ? ` · ${formatVisitWindow(
                    request.scheduledStartTime,
                    request.scheduledEndTime,
                  )}`
                : ""}
            </span>
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onShowFullDetails}
        className="flex w-full items-center justify-center gap-1.5 border-t border-outline-variant/40 bg-white/70 px-3 py-2.5 font-body text-[12px] font-semibold text-primary transition-colors hover:bg-primary/5"
      >
        View full request details
        <span className="material-symbols-outlined text-[18px]">unfold_more</span>
      </button>
    </section>
  );
}

function DetailDrawerContent({
  request,
  staff,
  initialMode,
  onInitialModeConsumed,
  onClose,
  onUpdated,
}: {
  request: InspectionRequestDetail;
  staff: StaffSummary[];
  initialMode: DrawerMode | null;
  onInitialModeConsumed: () => void;
  onClose: () => void;
  onUpdated: (next: InspectionRequestDetail) => void;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<DrawerMode>(initialMode ?? "review");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const actionPanelRef = useRef<HTMLDivElement>(null);
  const inBookingMode = mode === "convert_booking";
  const inActionMode = mode !== "review" && !inBookingMode;

  // Accept-form state
  const [acceptedSlot, setAcceptedSlot] = useState<InspectionSlot | null>(null);
  const [acceptNote, setAcceptNote] = useState("");
  const [acceptStartTime, setAcceptStartTime] = useState("10:00");
  const [acceptEndTime, setAcceptEndTime] = useState("11:00");

  // Propose-form state
  const [proposedSlots, setProposedSlots] = useState<InspectionSlot[]>([
    { date: "", timeRange: "morning" },
  ]);
  const [proposeNote, setProposeNote] = useState("");

  const [cancelNote, setCancelNote] = useState("");

  // Assign-form state
  const [assignTo, setAssignTo] = useState<"owner" | "staff" | null>(null);
  const [staffId, setStaffId] = useState<string>("");

  const [awaitingNote, setAwaitingNote] = useState("");

  const bookingTimeDefaults = useMemo(() => {
    const timeRange = request.scheduledSlot?.timeRange ?? "morning";
    const defaults = DEFAULT_VISIT_WINDOW[timeRange];
    return {
      start: request.scheduledStartTime ?? defaults.start,
      end: request.scheduledEndTime ?? defaults.end,
    };
  }, [
    request.id,
    request.scheduledSlot?.timeRange,
    request.scheduledStartTime,
    request.scheduledEndTime,
  ]);

  useEffect(() => {
    if (!initialMode || initialMode === "review") return;
    setMode(initialMode);
    onInitialModeConsumed();
  }, [initialMode, onInitialModeConsumed]);

  const hasVisitWindow =
    !!request.scheduledStartTime || !!request.scheduledEndTime;
  const needsInlineVisitTime =
    request.status === "scheduled" &&
    !!request.scheduledSlot &&
    !hasVisitWindow &&
    !request.quotation &&
    mode === "review";

  useEffect(() => {
    const slot = request.scheduledSlot;
    if (!slot) return;
    if (request.scheduledStartTime) {
      setAcceptStartTime(request.scheduledStartTime);
    } else {
      const defaults = DEFAULT_VISIT_WINDOW[slot.timeRange];
      setAcceptStartTime(defaults.start);
    }
    if (request.scheduledEndTime) {
      setAcceptEndTime(request.scheduledEndTime);
    } else {
      const defaults = DEFAULT_VISIT_WINDOW[slot.timeRange];
      setAcceptEndTime(defaults.end);
    }
  }, [
    request.id,
    request.scheduledSlot?.date,
    request.scheduledSlot?.timeRange,
    request.scheduledStartTime,
    request.scheduledEndTime,
  ]);

  function submitSetVisitTime() {
    if (!acceptStartTime || !acceptEndTime) {
      setActionError("Set a start and end time for the visit.");
      return;
    }
    if (acceptStartTime >= acceptEndTime) {
      setActionError("The end time must be after the start time.");
      return;
    }
    void callAction({
      action: "set_time",
      startTime: acceptStartTime,
      endTime: acceptEndTime,
    });
  }

  async function callAction(body: Record<string, unknown>) {
    if (!user) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/inspection-requests/${request.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        request?: InspectionRequestDetail;
      };
      if (!response.ok || !data.ok || !data.request) {
        throw new Error(data.error ?? "Could not update the request.");
      }
      const next = data.request;
      onUpdated(next);
      if (
        next.status === "scheduled" &&
        !next.assignedTo &&
        (body.action === "accept" || body.action === "assign")
      ) {
        if (body.action === "accept") {
          setMode("assign");
        } else {
          setMode("review");
        }
      } else {
        setMode("review");
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isClosed =
    request.status === "cancelled" ||
    (request.status === "completed" && !canFollowUpAfterQuotation(request));

  useEffect(() => {
    if (mode === "review") return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      if (mode === "convert_booking") {
        scroller.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const panel = actionPanelRef.current;
      if (!panel) return;
      scroller.scrollTo({
        top: Math.max(0, panel.offsetTop - 12),
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, request.id, request.status]);

  function openAction(nextMode: Exclude<DrawerMode, "review">) {
    setActionError(null);
    if (nextMode === "set_time") {
      if (request.scheduledStartTime) setAcceptStartTime(request.scheduledStartTime);
      if (request.scheduledEndTime) setAcceptEndTime(request.scheduledEndTime);
    }
    setMode(nextMode);
  }

  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-outline-variant/40 px-4 py-2.5 sm:px-5 sm:py-3">
        <div className="min-w-0">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            {inBookingMode ? "Create booking" : "Inspection request"}
          </p>
          <p className="mt-0.5">
            <InspectionRequestCode
              request={request}
              className="inline-flex items-baseline gap-px font-mono text-[12px] font-semibold text-primary"
            />
          </p>
          <h3 className="mt-0.5 truncate font-display text-[17px] font-semibold leading-snug text-on-surface">
            {request.requestType === "existing_service"
              ? request.serviceName ?? "Existing service"
              : request.customRequest?.title ?? "Custom quotation request"}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-bold uppercase tracking-wider ${STATUS_TONE[request.status]}`}
            >
              {STATUS_LABELS[request.status]}
            </span>
            <CreatedSourcePill source={request.createdSource} />
            {request.bookingStatus ? (
              <BookingStatusPill status={request.bookingStatus} />
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
          aria-label="Close drawer"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div
        ref={scrollRef}
        className="min-w-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-4 py-3 sm:space-y-3 sm:px-5"
      >
        {inBookingMode ? (
          <ConvertToBookingPanel
            inspectionRequestId={request.id}
            minBookingDate={bookingMinDateFromRequest(request)}
            initialStartTime={bookingTimeDefaults.start}
            initialEndTime={bookingTimeDefaults.end}
            onSuccess={(updated) => {
              onUpdated(updated);
              setMode("review");
            }}
            onCancel={() => setMode("review")}
          />
        ) : inActionMode ? (
          <CompactRequestSummary
            request={request}
            onShowFullDetails={() => setMode("review")}
          />
        ) : (
          <>
            <CustomerSection request={request} />
            <RequestDetailsSection request={request} />
            <CustomerExtrasSection request={request} />
            <SlotsOverview
              request={request}
              inlineVisitTime={
                needsInlineVisitTime
                  ? {
                      startTime: acceptStartTime,
                      endTime: acceptEndTime,
                      disabled: submitting,
                      onStartTimeChange: setAcceptStartTime,
                      onEndTimeChange: setAcceptEndTime,
                      onSave: submitSetVisitTime,
                    }
                  : undefined
              }
            />
            {request.assignedTo ? <AssignmentSummary request={request} /> : null}
            {request.ownerNote ? (
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
                <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  {request.status === "cancelled"
                    ? "Cancellation note"
                    : "Owner note"}
                </p>
                <p className="mt-1 font-body text-body-md text-on-surface">
                  {request.ownerNote}
                </p>
              </div>
            ) : null}
            <QuotationSection requestId={request.id} />
            <BookingDetailsSection
              bookingId={request.bookingId}
              bookingCode={request.bookingCode}
            />
          </>
        )}

        {!inBookingMode && actionError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
          >
            {actionError}
          </div>
        ) : null}

        {!inBookingMode ? (
        <div ref={actionPanelRef} className="space-y-4">
        {mode === "accept" ? (
          <AcceptForm
            slots={request.preferredSlots}
            value={acceptedSlot}
            note={acceptNote}
            startTime={acceptStartTime}
            endTime={acceptEndTime}
            onChange={setAcceptedSlot}
            onNoteChange={setAcceptNote}
            onStartTimeChange={setAcceptStartTime}
            onEndTimeChange={setAcceptEndTime}
            disabled={submitting}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              if (!acceptedSlot) {
                setActionError(
                  "Pick one of the customer's preferred dates to accept.",
                );
                return;
              }
              if (!acceptStartTime || !acceptEndTime) {
                setActionError("Set a start and end time for the visit.");
                return;
              }
              if (acceptStartTime >= acceptEndTime) {
                setActionError("The end time must be after the start time.");
                return;
              }
              void callAction({
                action: "accept",
                slot: acceptedSlot,
                startTime: acceptStartTime,
                endTime: acceptEndTime,
                note: acceptNote || undefined,
              });
            }}
          />
        ) : null}

        {mode === "set_time" ? (
          <SetTimeForm
            slot={request.scheduledSlot}
            startTime={acceptStartTime}
            endTime={acceptEndTime}
            disabled={submitting}
            onStartTimeChange={setAcceptStartTime}
            onEndTimeChange={setAcceptEndTime}
            onCancel={() => setMode("review")}
            onSubmit={submitSetVisitTime}
          />
        ) : null}

        {mode === "propose" ? (
          <ProposeForm
            slots={proposedSlots}
            customerPreferredSlots={request.preferredSlots}
            note={proposeNote}
            disabled={submitting}
            onChange={setProposedSlots}
            onNoteChange={setProposeNote}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              const validSlots = proposedSlots.filter(
                (slot) => slot.date && slot.timeRange,
              );
              if (validSlots.length === 0) {
                setActionError(
                  "Add at least one proposed date and time range.",
                );
                return;
              }
              const repeatsCustomer = validSlots.some((slot) =>
                request.preferredSlots.some(
                  (preferred) =>
                    preferred.date === slot.date &&
                    preferred.timeRange === slot.timeRange,
                ),
              );
              if (repeatsCustomer) {
                setActionError(
                  "Each option must be different from the customer's original times.",
                );
                return;
              }
              void callAction({
                action: "propose",
                slots: validSlots,
                note: proposeNote || undefined,
              });
            }}
          />
        ) : null}

        {mode === "assign" ? (
          <AssignForm
            staff={staff}
            assignTo={assignTo}
            staffId={staffId}
            disabled={submitting}
            onAssignToChange={setAssignTo}
            onStaffIdChange={setStaffId}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              if (!assignTo) {
                setActionError("Pick who should run the inspection.");
                return;
              }
              if (assignTo === "staff" && !staffId) {
                setActionError("Choose a staff member to assign.");
                return;
              }
              void callAction({
                action: "assign",
                assignTo,
                staffId: assignTo === "staff" ? staffId : undefined,
              });
            }}
          />
        ) : null}

        {mode === "cancel" ? (
          <CancelForm
            note={cancelNote}
            disabled={submitting}
            onNoteChange={setCancelNote}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              void callAction({
                action: "cancel",
                note: cancelNote.trim() || undefined,
              });
            }}
          />
        ) : null}

        {mode === "awaiting_decision" ? (
          <AwaitingDecisionForm
            note={awaitingNote}
            disabled={submitting}
            onNoteChange={setAwaitingNote}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              void callAction({
                action: "mark_awaiting_decision",
                note: awaitingNote.trim() || undefined,
              });
            }}
          />
        ) : null}
        </div>
        ) : null}

        {!inBookingMode &&
        mode === "review" &&
        (!isClosed || canFollowUpAfterQuotation(request)) ? (
          <DrawerReviewFooter
            request={request}
            submitting={submitting}
            onAccept={() => openAction("accept")}
            onPropose={() => openAction("propose")}
            onSetTime={() => openAction("set_time")}
            onAssign={() => openAction("assign")}
            onComplete={() => void callAction({ action: "complete" })}
            onCancel={() => openAction("cancel")}
            onCreateBooking={() => openAction("convert_booking")}
            onAwaitingDecision={() => openAction("awaiting_decision")}
          />
        ) : null}
      </div>
    </>
  );
}

/* ==========================================================================
 * Drawer subsections
 * ========================================================================== */

type QuotationView = {
  id: string;
  quotationCode: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  bookingStatus: BookingStatus | null;
  serviceTitle: string;
  lineItems: { name: string; priceAud: number }[];
  subtotalAud: number;
  finalPriceAud: number;
  notes: string | null;
  validUntil: string | null;
  imageUrls: string[];
  pdfUrl: string | null;
  createdAt: number | null;
};

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

/** Loads and displays quotations created for this inspection request. */
function QuotationSection({ requestId }: { requestId: string }) {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState<QuotationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/quotations?inspectionRequestId=${encodeURIComponent(requestId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          quotations?: QuotationView[];
        };
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Could not load quotations.");
        }
        if (active) setQuotations(data.quotations ?? []);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Could not load quotations.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [requestId, user]);

  if (loading) {
    return (
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Quotation
        </p>
        <p className="mt-1.5 flex items-center gap-2 font-body text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[18px]">
            progress_activity
          </span>
          Loading…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-rose-700">
          Quotation
        </p>
        <p className="mt-1 font-body text-[13px] text-rose-700">{error}</p>
      </section>
    );
  }

  if (quotations.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Quotation{quotations.length > 1 ? "s" : ""}
      </p>
      <div className="mt-2 space-y-2">
        {quotations.map((quotation) => (
          <QuotationCard key={quotation.id} quotation={quotation} />
        ))}
      </div>
    </section>
  );
}

function QuotationCard({ quotation }: { quotation: QuotationView }) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const title = quotation.serviceTitle || "Quotation";
  const downloadFilename = `quotation-${title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "bmspro"}.pdf`;

  return (
    <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] font-semibold tracking-wide text-primary">
              {displayQuotationCode(quotation)}
            </p>
            {quotation.bookingId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                {displayBookingCode({
                  id: quotation.bookingId,
                  bookingCode: quotation.bookingCode,
                })}
              </span>
            ) : null}
            {quotation.bookingStatus ? (
              <BookingStatusPill status={quotation.bookingStatus} />
            ) : null}
          </div>
          <p className="mt-1 truncate font-display text-[14px] font-semibold text-on-surface">
            {title}
          </p>
          {quotation.createdAt ? (
            <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
              {new Date(quotation.createdAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          ) : null}
        </div>
        {quotation.pdfUrl ? (
          <button
            type="button"
            onClick={() => setPdfOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-body text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[16px]">
              picture_as_pdf
            </span>
            View PDF
          </button>
        ) : null}
      </div>

      <ul className="mt-3 space-y-1.5">
        {quotation.lineItems.map((item, index) => (
          <li
            key={`item-${index}`}
            className="flex items-center justify-between gap-3 font-body text-[13px]"
          >
            <span className="min-w-0 truncate text-on-surface">{item.name}</span>
            <span className="shrink-0 text-on-surface-variant">
              {formatAud(item.priceAud)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-outline-variant/50 pt-2 font-body text-[12px] font-semibold text-on-surface-variant">
        <span>Total item price</span>
        <span>{formatAud(quotation.subtotalAud)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-primary/10 px-3 py-2">
        <span className="font-body text-[12px] font-bold uppercase tracking-wider text-primary">
          Final price
        </span>
        <span className="font-display text-[16px] font-bold text-primary">
          {formatAud(quotation.finalPriceAud)}
        </span>
      </div>

      {quotation.notes ? (
        <p className="mt-3 font-body text-[12px] text-on-surface-variant">
          {quotation.notes}
        </p>
      ) : null}

      {quotation.imageUrls.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {quotation.imageUrls.map((url, index) => (
            <a
              key={`photo-${index}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-16 w-16 overflow-hidden rounded-lg border border-outline-variant/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Quotation photo ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

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

function formatEstimatedMinutes(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
}

/** Job booking linked to this visit (shown below quotation). */
function BookingDetailsSection({
  bookingId,
  bookingCode,
}: {
  bookingId: string | null;
  bookingCode: string | null;
}) {
  const { user } = useAuth();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId || !user) {
      setBooking(null);
      setError(null);
      return;
    }

    const authedUser = user;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await authedUser.getIdToken();
        const response = await fetch(`/api/bookings/${bookingId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          booking?: BookingDetail;
        };
        if (!response.ok || !data.ok || !data.booking) {
          throw new Error(data.error ?? "Could not load booking.");
        }
        if (active) setBooking(data.booking);
      } catch (err) {
        if (active) {
          setBooking(null);
          setError(
            err instanceof Error ? err.message : "Could not load booking.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [bookingId, user]);

  if (!bookingId) return null;

  if (loading) {
    return (
      <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
          Booking
        </p>
        <p className="mt-1.5 flex items-center gap-2 font-body text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[16px]">
            progress_activity
          </span>
          Loading…
        </p>
      </section>
    );
  }

  if (error || !booking) {
    return (
      <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
          Booking
        </p>
        {bookingCode ? (
          <p className="mt-1 font-mono text-[12px] font-semibold text-primary">
            {displayBookingCode({
              id: bookingId,
              bookingCode,
            })}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const estimate = formatEstimatedMinutes(booking.estimatedDurationMinutes);

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
        Booking
      </p>
      <div className="mt-2 rounded-xl border border-primary/20 bg-surface-container-lowest p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
            {displayBookingCode(booking)}
          </span>
          <BookingStatusPill status={booking.status} />
        </div>

        {booking.scheduledSlot ? (
          <div className="mt-3 space-y-2">
            <p className="flex items-center gap-1.5 font-body text-[13px] font-semibold text-on-surface">
              <span className="material-symbols-outlined text-[16px] text-primary">
                event
              </span>
              {formatSlotDate(booking.scheduledSlot.date)} ·{" "}
              {TIME_RANGE_LABELS[booking.scheduledSlot.timeRange]}
            </p>
            {visitWindow ? (
              <p className="flex items-center gap-1.5 font-body text-[12px] font-semibold text-emerald-800">
                <span className="material-symbols-outlined text-[14px] text-emerald-700">
                  schedule
                </span>
                {visitWindow}
              </p>
            ) : null}
            {estimate ? (
              <p className="flex items-center gap-1.5 font-body text-[12px] text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px] text-primary">
                  timelapse
                </span>
                Estimated {estimate} on site
              </p>
            ) : null}
          </div>
        ) : null}

        {booking.ownerNote ? (
          <p className="mt-3 border-t border-outline-variant/40 pt-2 font-body text-[12px] leading-relaxed text-on-surface-variant">
            <span className="font-semibold text-on-surface">Note: </span>
            {booking.ownerNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CustomerSection({ request }: { request: InspectionRequestDetail }) {
  const phoneHref = request.customer.phone
    ? `tel:${request.customer.phone}`
    : null;
  const emailHref = request.customer.email
    ? `mailto:${request.customer.email}`
    : null;

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Customer
      </p>
      <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
        {request.customer.fullName}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <a
          href={phoneHref ?? "#"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-low px-2.5 py-1.5 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">
            call
          </span>
          {request.customer.phone || "—"}
        </a>
        <a
          href={emailHref ?? "#"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-low px-2.5 py-1.5 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">
            mail
          </span>
          <span className="truncate">{request.customer.email}</span>
        </a>
      </div>
      <p className="mt-2 inline-flex items-start gap-1.5 font-body text-[13px] leading-snug text-on-surface">
        <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-primary">
          location_on
        </span>
        {formatAddress(request.address)}
      </p>
    </section>
  );
}

function RequestDetailsSection({
  request,
}: {
  request: InspectionRequestDetail;
}) {
  if (request.requestType === "existing_service") {
    return (
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Service requested
        </p>
        <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
          {request.serviceName ?? "—"}
        </p>
        {request.serviceBusinessType ? (
          <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
            {request.serviceBusinessType}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Custom quote request
      </p>
      <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
        {request.customRequest?.title ?? "—"}
      </p>
      {request.customRequest?.description ? (
        <p className="mt-1.5 whitespace-pre-line font-body text-[13px] leading-relaxed text-on-surface-variant">
          {request.customRequest.description}
        </p>
      ) : null}
    </section>
  );
}

function slotTimeIcon(timeRange: InspectionTimeRange): string {
  return timeRange === "morning" ? "wb_twilight" : "wb_sunny";
}

function InspectionSlotsList({
  slots,
  variant = "customer",
  timeWindow = null,
}: {
  slots: InspectionSlot[];
  variant?: "customer" | "proposed" | "scheduled";
  timeWindow?: string | null;
}) {
  if (slots.length === 0) return null;

  const cardClass =
    variant === "proposed"
      ? "border-violet-200/90 bg-violet-50/70"
      : variant === "scheduled"
        ? "border-emerald-200/90 bg-emerald-50/70"
        : "border-outline-variant/50 bg-surface-container-lowest";

  const timeClass =
    variant === "proposed"
      ? "text-violet-900"
      : variant === "scheduled"
        ? "text-emerald-900"
        : "text-on-surface-variant";

  return (
    <ul className="mt-1.5 space-y-1.5">
      {slots.map((slot, index) => (
        <li
          key={`${slot.date}-${slot.timeRange}-${index}`}
          className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 shadow-sm ${cardClass}`}
        >
          {slots.length > 1 ? (
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-body text-[11px] font-bold text-primary"
              aria-hidden
            >
              {index + 1}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-body text-[13px] font-semibold leading-snug text-on-surface">
              <span className="material-symbols-outlined text-[17px] text-primary">
                event
              </span>
              {formatSlotDate(slot.date)}
            </p>
            <p
              className={`mt-1 flex items-center gap-1.5 font-body text-[12px] leading-snug ${timeClass}`}
            >
              <span className="material-symbols-outlined text-[16px] text-primary/85">
                {slotTimeIcon(slot.timeRange)}
              </span>
              {TIME_RANGE_LABELS[slot.timeRange]}
            </p>
            {variant === "scheduled" && timeWindow ? (
              <p className="mt-1 flex items-center gap-1.5 font-body text-[12px] font-semibold leading-snug text-emerald-900">
                <span className="material-symbols-outlined text-[16px] text-emerald-700">
                  schedule
                </span>
                {timeWindow}
              </p>
            ) : variant === "scheduled" && !timeWindow ? (
              <p className="mt-1 flex items-center gap-1.5 font-body text-[12px] font-medium leading-snug text-amber-800/90">
                <span className="material-symbols-outlined text-[16px] text-amber-700">
                  schedule
                </span>
                Exact time to be added below
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CustomerExtrasSection({
  request,
}: {
  request: InspectionRequestDetail;
}) {
  const budgetLabel = formatBudgetAud(request.budgetAud);
  if (!request.customerNotes && !budgetLabel) return null;

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Customer notes &amp; budget
      </p>
      {request.customerNotes ? (
        <p className="mt-1.5 whitespace-pre-line font-body text-[13px] leading-relaxed text-on-surface">
          {request.customerNotes}
        </p>
      ) : null}
      {budgetLabel ? (
        <p
          className={`font-display text-[16px] font-semibold text-primary ${
            request.customerNotes ? "mt-2" : "mt-1"
          }`}
        >
          {budgetLabel}
        </p>
      ) : null}
    </section>
  );
}

type InlineVisitTimeControl = {
  startTime: string;
  endTime: string;
  disabled: boolean;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onSave: () => void;
};

function SlotsOverview({
  request,
  inlineVisitTime,
}: {
  request: InspectionRequestDetail;
  inlineVisitTime?: InlineVisitTimeControl;
}) {
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Customer&apos;s preferred dates
      </p>
      <InspectionSlotsList slots={request.preferredSlots} variant="customer" />

      {request.ownerProposedSlots.length > 0 ? (
        <>
          <p className="mt-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Your proposed dates
          </p>
          <InspectionSlotsList
            slots={request.ownerProposedSlots}
            variant="proposed"
          />
        </>
      ) : null}

      {request.scheduledSlot ? (
        <ScheduledVisitSection
          request={request}
          inlineVisitTime={inlineVisitTime}
        />
      ) : null}
    </section>
  );
}

function ScheduledVisitSection({
  request,
  inlineVisitTime,
}: {
  request: InspectionRequestDetail;
  inlineVisitTime?: InlineVisitTimeControl;
}) {
  const slot = request.scheduledSlot;
  if (!slot) return null;

  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const customerAccepted =
    request.status === "scheduled" && request.ownerProposedSlots.length > 0;

  return (
    <>
      <p className="mt-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-emerald-800">
        Scheduled visit
      </p>
      <InspectionSlotsList
        slots={[slot]}
        variant="scheduled"
        timeWindow={visitWindow}
      />
      {inlineVisitTime ? (
        <div className="mt-3 rounded-xl border border-amber-200/90 bg-amber-50/90 p-4 shadow-sm">
          <p className="flex items-start gap-2 font-body text-[13px] font-semibold leading-snug text-amber-950">
            <span className="material-symbols-outlined shrink-0 text-[20px] text-amber-700">
              schedule
            </span>
            {customerAccepted
              ? "Customer accepted this date — add the visit time"
              : "Add the exact visit time"}
          </p>
          <p className="mt-1 pl-7 font-body text-[12px] leading-relaxed text-amber-900/90">
            Pick a time within{" "}
            {TIME_RANGE_SHORT_LABELS[slot.timeRange].toLowerCase()} so the
            customer knows when you will arrive.
          </p>
          <label className="mt-3 block pl-7">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-amber-900/80">
              Visit time range
            </span>
            <div className="mt-1.5">
              <VisitTimeRangeFields
                startTime={inlineVisitTime.startTime}
                endTime={inlineVisitTime.endTime}
                timeRange={slot.timeRange}
                disabled={inlineVisitTime.disabled}
                onStartTimeChange={inlineVisitTime.onStartTimeChange}
                onEndTimeChange={inlineVisitTime.onEndTimeChange}
              />
            </div>
          </label>
          <button
            type="button"
            disabled={inlineVisitTime.disabled}
            onClick={inlineVisitTime.onSave}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              schedule
            </span>
            Save visit time
          </button>
        </div>
      ) : !visitWindow ? (
        <p className="mt-2 flex items-center gap-1.5 font-body text-[12px] font-medium text-amber-800">
          <span className="material-symbols-outlined text-[16px]">info</span>
          Time window not set yet
        </p>
      ) : null}
    </>
  );
}

function AssignmentSummary({
  request,
}: {
  request: InspectionRequestDetail;
}) {
  const assigned = request.assignedTo;
  if (!assigned) return null;
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
        Inspector assigned
      </p>
      <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
        {assigned.name}
      </p>
      <p className="font-body text-[12px] text-on-surface-variant">
        {assigned.type === "owner"
          ? "Business owner is handling this visit"
          : assigned.email ?? "Staff member"}
      </p>
    </section>
  );
}

/* ==========================================================================
 * Visit time range (two dropdowns, no native time picker)
 * ========================================================================== */

const VISIT_TIME_STEP_MINUTES = 30;

function minutesFromMidnight(clock: string): number {
  if (!isClockTime(clock)) return 0;
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

const JOB_TIME_START_HOUR = 6;
const JOB_TIME_END_HOUR = 23;

/** 15-minute slots for a full job day (bookings), 6:00am–11:45pm. */
function jobTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let hour = JOB_TIME_START_HOUR; hour <= JOB_TIME_END_HOUR; hour += 1) {
    for (let minute = 0; minute < 60; minute += VISIT_TIME_STEP_MINUTES) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const label = formatClockTime(value);
      if (label) options.push({ value, label });
    }
  }
  return options;
}

/** 15-minute options within morning (8–12) or afternoon (12–17). */
function visitTimeOptions(
  timeRange: InspectionTimeRange | null,
): { value: string; label: string }[] {
  const startHour = timeRange === "afternoon" ? 12 : 8;
  const endHour = timeRange === "afternoon" ? 17 : 12;
  const options: { value: string; label: string }[] = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    for (let minute = 0; minute < 60; minute += VISIT_TIME_STEP_MINUTES) {
      if (hour === endHour && minute > 0) continue;
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const label = formatClockTime(value);
      if (label) options.push({ value, label });
    }
  }
  return options;
}

const DEFAULT_VISIT_WINDOW: Record<
  InspectionTimeRange,
  { start: string; end: string }
> = {
  morning: { start: "10:00", end: "11:00" },
  afternoon: { start: "13:00", end: "14:00" },
};

function VisitTimeRangeFields({
  startTime,
  endTime,
  timeRange,
  fullDay = false,
  disabled,
  onStartTimeChange,
  onEndTimeChange,
}: {
  startTime: string;
  endTime: string;
  timeRange: InspectionTimeRange | null;
  /** Job bookings: full day (6am–11:45pm), not morning/afternoon visit windows. */
  fullDay?: boolean;
  disabled: boolean;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}) {
  const options = useMemo(
    () => (fullDay ? jobTimeOptions() : visitTimeOptions(timeRange)),
    [timeRange, fullDay],
  );
  const startValid = isClockTime(startTime);
  const endValid = isClockTime(endTime);

  const endOptions = useMemo(() => {
    if (!startValid) return options;
    const minEnd = minutesFromMidnight(startTime) + VISIT_TIME_STEP_MINUTES;
    return options.filter((opt) => minutesFromMidnight(opt.value) >= minEnd);
  }, [options, startTime, startValid]);

  useEffect(() => {
    if (fullDay || !timeRange) return;
    const opts = visitTimeOptions(timeRange);
    if (!opts.some((o) => o.value === startTime)) {
      const defaults = DEFAULT_VISIT_WINDOW[timeRange];
      onStartTimeChange(defaults.start);
      onEndTimeChange(defaults.end);
    }
  }, [fullDay, timeRange, startTime, onStartTimeChange, onEndTimeChange]);

  useEffect(() => {
    if (!startValid || !endValid) return;
    if (minutesFromMidnight(startTime) >= minutesFromMidnight(endTime)) {
      const next = endOptions[0]?.value;
      if (next) onEndTimeChange(next);
    }
  }, [startTime, endTime, startValid, endValid, endOptions, onEndTimeChange]);

  const selectClass =
    "w-full appearance-none rounded-lg border border-outline-variant/60 bg-white bg-[length:0.875rem] bg-[right_1.1rem_center] bg-no-repeat py-2 pl-2.5 pr-9 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60";
  const chevronBg =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")";

  return (
    <div className="flex items-center gap-2">
      <select
        value={startTime}
        disabled={disabled}
        aria-label="Visit start time"
        onChange={(event) => onStartTimeChange(event.target.value)}
        className={selectClass}
        style={{ backgroundImage: chevronBg }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="shrink-0 font-body text-[13px] text-on-surface-variant">
        –
      </span>
      <select
        value={endTime}
        disabled={disabled || endOptions.length === 0}
        aria-label="Visit end time"
        onChange={(event) => onEndTimeChange(event.target.value)}
        className={selectClass}
        style={{ backgroundImage: chevronBg }}
      >
        {endOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ==========================================================================
 * Action forms
 * ========================================================================== */

function CancelForm({
  note,
  disabled,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  note: string;
  disabled: boolean;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Cancel this request
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        The customer will see this visit as cancelled. Add an optional note
        explaining why (shown in their notifications and request history).
      </p>
      <label className="mt-3 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Note for customer (optional)
        </span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. We’re fully booked this week — please submit new dates or call us."
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/60 bg-white px-3 py-2 font-body text-[13px] text-on-surface focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-200/80"
        />
      </label>
      <FormActions
        confirmLabel="Cancel request"
        confirmIcon="event_busy"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function SetTimeForm({
  slot,
  startTime,
  endTime,
  disabled,
  onStartTimeChange,
  onEndTimeChange,
  onCancel,
  onSubmit,
}: {
  slot: InspectionSlot | null;
  startTime: string;
  endTime: string;
  disabled: boolean;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Set visit time range
      </p>
      {slot ? (
        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
          {formatSlotDate(slot.date)} · {TIME_RANGE_SHORT_LABELS[slot.timeRange]}
        </p>
      ) : null}
      <label className="mt-3 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Time range
        </span>
        <div className="mt-1">
          <VisitTimeRangeFields
            startTime={startTime}
            endTime={endTime}
            timeRange={slot?.timeRange ?? null}
            disabled={disabled}
            onStartTimeChange={onStartTimeChange}
            onEndTimeChange={onEndTimeChange}
          />
        </div>
      </label>
      <FormActions
        confirmLabel="Save visit time"
        confirmIcon="schedule"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

/** Earliest selectable job day: inspection visit date (inclusive), then later days only. */
function bookingMinDateFromRequest(request: InspectionRequestDetail): string {
  const scheduled = request.scheduledSlot?.date?.trim();
  if (scheduled) return scheduled;
  const preferredDates = request.preferredSlots
    .map((slot) => slot.date?.trim())
    .filter((date): date is string => Boolean(date))
    .sort();
  if (preferredDates.length > 0) return preferredDates[0];
  return todayIso();
}

function AwaitingDecisionForm({
  note,
  onNoteChange,
  disabled,
  onCancel,
  onSubmit,
}: {
  note: string;
  onNoteChange: (value: string) => void;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50/80 p-4">
      <h4 className="font-display text-[15px] font-semibold text-on-surface">
        Awaiting decision
      </h4>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Use when the customer is reviewing the quotation and will get back to
        you later (e.g. after referring the quote).
      </p>
      <label className="mt-4 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Internal note (optional)
        </span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. Customer will call back after discussing with partner."
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/60 bg-white px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
      </label>
      <FormActions
        confirmLabel="Save"
        confirmIcon="pending_actions"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function AcceptForm({
  slots,
  value,
  note,
  startTime,
  endTime,
  disabled,
  onChange,
  onNoteChange,
  onStartTimeChange,
  onEndTimeChange,
  onCancel,
  onSubmit,
}: {
  slots: InspectionSlot[];
  value: InspectionSlot | null;
  note: string;
  startTime: string;
  endTime: string;
  disabled: boolean;
  onChange: (slot: InspectionSlot | null) => void;
  onNoteChange: (note: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const selectedRange = value?.timeRange ?? null;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Accept one of the customer&apos;s dates
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Pick the option that works best, then set the visit time range.
      </p>
      <ul className="mt-3 space-y-2">
        {slots.map((slot, idx) => {
          const id = `${slot.date}-${slot.timeRange}-${idx}`;
          const checked =
            value?.date === slot.date && value.timeRange === slot.timeRange;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(slot)}
                disabled={disabled}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  checked
                    ? "border-primary bg-white ring-1 ring-primary/30"
                    : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-body text-[13px] font-semibold text-on-surface">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      event
                    </span>
                    {formatSlotDate(slot.date)}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 font-body text-[12px] text-on-surface-variant">
                    <span className="material-symbols-outlined text-[15px] text-primary/80">
                      {slotTimeIcon(slot.timeRange)}
                    </span>
                    {TIME_RANGE_LABELS[slot.timeRange]}
                  </span>
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                    checked
                      ? "border-primary bg-primary text-on-primary"
                      : "border-stone-300 bg-white text-transparent"
                  }`}
                >
                  {checked ? (
                    <span className="material-symbols-outlined text-[14px]">
                      check
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {value ? (
        <label className="mt-3 block">
          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Time range
          </span>
          <div className="mt-1">
            <VisitTimeRangeFields
              startTime={startTime}
              endTime={endTime}
              timeRange={selectedRange}
              disabled={disabled}
              onStartTimeChange={onStartTimeChange}
              onEndTimeChange={onEndTimeChange}
            />
          </div>
        </label>
      ) : null}

      <label className="mt-3 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Note for customer (optional)
        </span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. Our inspector will call ahead 30 minutes before arriving."
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
      </label>
      <FormActions
        confirmLabel="Confirm visit"
        confirmIcon="event_available"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

const PROPOSE_TIME_OPTIONS: {
  id: InspectionTimeRange;
  label: string;
  hint: string;
  icon: string;
}[] = [
  { id: "morning", label: "Morning", hint: "8am – 12pm", icon: "wb_twilight" },
  { id: "afternoon", label: "Afternoon", hint: "12pm – 5pm", icon: "wb_sunny" },
];

function ProposeSlotOption({
  slot,
  index,
  minDate,
  disabled,
  canRemove,
  customerPreferredSlots,
  allSlots,
  onUpdate,
  onRemove,
}: {
  slot: InspectionSlot;
  index: number;
  minDate: string;
  disabled: boolean;
  canRemove: boolean;
  customerPreferredSlots: InspectionSlot[];
  allSlots: InspectionSlot[];
  onUpdate: <K extends keyof InspectionSlot>(
    key: K,
    value: InspectionSlot[K],
  ) => void;
  onRemove: () => void;
}) {
  const [dayPage, setDayPage] = useState(0);

  const customerBlocked = useMemo(
    () => buildBlockedComboSet(customerPreferredSlots),
    [customerPreferredSlots],
  );

  const blockedCombos = useMemo(() => {
    const set = new Set(customerBlocked);
    allSlots.forEach((entry, idx) => {
      if (idx !== index && entry.date) {
        set.add(slotComboKey(entry.date, entry.timeRange));
      }
    });
    return set;
  }, [customerBlocked, allSlots, index]);

  function selectDate(iso: string) {
    onUpdate("date", iso);
    if (blockedCombos.has(slotComboKey(iso, slot.timeRange))) {
      for (const range of TIME_RANGES) {
        if (!blockedCombos.has(slotComboKey(iso, range))) {
          onUpdate("timeRange", range);
          return;
        }
      }
    }
  }

  return (
    <li className="rounded-lg border border-outline-variant/60 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
          Option {index + 1}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-body text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        <SlotDayPicker
          selectedIso={slot.date}
          minDate={minDate}
          dayPage={dayPage}
          onDayPageChange={setDayPage}
          onSelect={selectDate}
          disabled={disabled}
          blockedCombos={blockedCombos}
          dayStripLayout="fit"
        />
      </div>

      <div className="mt-4">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Time window
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PROPOSE_TIME_OPTIONS.map((option) => {
            const checked = slot.timeRange === option.id;
            const comboBlocked =
              !!slot.date &&
              blockedCombos.has(slotComboKey(slot.date, option.id));
            const customerPick =
              !!slot.date &&
              customerBlocked.has(slotComboKey(slot.date, option.id));
            const timeDisabled = !slot.date || comboBlocked;
            return (
              <button
                type="button"
                key={option.id}
                disabled={disabled || timeDisabled}
                title={
                  customerPick
                    ? "Customer already chose this time"
                    : comboBlocked
                      ? "Already used in another option"
                      : undefined
                }
                onClick={() => onUpdate("timeRange", option.id)}
                className={`relative flex min-h-[4.5rem] flex-col justify-between rounded-2xl border px-3 py-2.5 text-left transition-all ${
                  timeDisabled || disabled
                    ? "cursor-not-allowed border-stone-100 bg-stone-50 opacity-45"
                    : checked
                      ? "border-primary bg-gradient-to-br from-primary/15 via-white to-amber-50/80 ring-2 ring-primary/20"
                      : "border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm"
                }`}
              >
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${
                    checked
                      ? "bg-primary text-on-primary shadow-sm"
                      : "bg-stone-100 text-stone-600"
                  }`}
                >
                  <span className="material-symbols-outlined material-symbols-filled text-[18px]">
                    {option.icon}
                  </span>
                </span>
                <span>
                  <span className="block font-body text-[12px] font-bold text-on-surface">
                    {option.label}
                  </span>
                  <span className="font-body text-[10px] text-on-surface-variant">
                    {customerPick ? "Customer's pick" : option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

function ProposeForm({
  slots,
  customerPreferredSlots,
  note,
  disabled,
  onChange,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  slots: InspectionSlot[];
  customerPreferredSlots: InspectionSlot[];
  note: string;
  disabled: boolean;
  onChange: (slots: InspectionSlot[]) => void;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const minDate = todayIso();

  function updateSlot<K extends keyof InspectionSlot>(
    index: number,
    key: K,
    value: InspectionSlot[K],
  ) {
    onChange(
      slots.map((slot, idx) =>
        idx === index ? { ...slot, [key]: value } : slot,
      ),
    );
  }

  function addSlot() {
    if (slots.length >= 3) return;
    onChange([...slots, { date: "", timeRange: "morning" }]);
  }

  function removeSlot(index: number) {
    if (slots.length === 1) return;
    onChange(slots.filter((_, idx) => idx !== index));
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Propose new dates
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Add up to 3 alternatives. Times the customer already chose cannot be
        selected again.
      </p>

      <ul className="mt-3 space-y-3">
        {slots.map((slot, index) => (
          <ProposeSlotOption
            key={index}
            slot={slot}
            index={index}
            minDate={minDate}
            disabled={disabled}
            canRemove={slots.length > 1}
            customerPreferredSlots={customerPreferredSlots}
            allSlots={slots}
            onUpdate={(key, value) => updateSlot(index, key, value)}
            onRemove={() => removeSlot(index)}
          />
        ))}
      </ul>

      {slots.length < 3 ? (
        <button
          type="button"
          onClick={addSlot}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-outline-variant/60 bg-white px-3 py-1.5 font-body text-[12px] font-semibold text-on-surface transition-colors hover:border-primary hover:text-primary"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add another option
        </button>
      ) : null}

      <label className="mt-3 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Note for customer (optional)
        </span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. We're booked on the dates you picked — these alternatives work for us."
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/60 bg-white px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <FormActions
        confirmLabel="Send proposal"
        confirmIcon="send"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function StaffMemberPicker({
  staff,
  value,
  disabled,
  onChange,
}: {
  staff: StaffSummary[];
  value: string;
  disabled: boolean;
  onChange: (staffId: string) => void;
}) {
  return (
    <ul className="max-h-[min(16rem,42vh)] space-y-2 overflow-y-auto pr-0.5">
      {staff.map((member) => {
        const selected = value === member.id;
        return (
          <li key={member.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(member.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "border-primary bg-white ring-1 ring-primary/30"
                  : "border-outline-variant/60 bg-white hover:border-primary/40 hover:bg-primary/[0.03]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={staffAvatarUrl(member)}
                alt=""
                className="h-11 w-11 shrink-0 rounded-full border-2 border-white bg-surface-container-low object-cover shadow-sm ring-1 ring-outline-variant/30"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-body text-[13px] font-semibold text-on-surface">
                  {member.fullName}
                </span>
                <span className="mt-0.5 block truncate font-body text-[11px] text-on-surface-variant">
                  {member.staffType}
                  {member.email ? ` · ${member.email}` : ""}
                </span>
              </span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  selected
                    ? "border-primary bg-primary text-on-primary"
                    : "border-stone-300 bg-white text-transparent"
                }`}
                aria-hidden
              >
                {selected ? (
                  <span className="material-symbols-outlined text-[14px]">
                    check
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AssignForm({
  staff,
  assignTo,
  staffId,
  disabled,
  onAssignToChange,
  onStaffIdChange,
  onCancel,
  onSubmit,
}: {
  staff: StaffSummary[];
  assignTo: "owner" | "staff" | null;
  staffId: string;
  disabled: boolean;
  onAssignToChange: (value: "owner" | "staff") => void;
  onStaffIdChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { user } = useAuth();
  const ownerAvatar = staffAvatarUrl({
    id: user?.uid ?? "owner",
    fullName: user?.displayName ?? "Business owner",
    email: user?.email ?? "",
  });

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Assign the inspection
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        The assigned person will visit the customer location and create the
        quotation.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onAssignToChange("owner")}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
            assignTo === "owner"
              ? "border-primary bg-white ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ownerAvatar}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full border-2 border-white bg-surface-container-low object-cover shadow-sm ring-1 ring-outline-variant/30"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign to me
            </span>
            <span className="block truncate font-body text-[11px] text-on-surface-variant">
              {user?.displayName ?? user?.email ?? "Business owner"}
            </span>
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
              assignTo === "owner"
                ? "border-primary bg-primary text-on-primary"
                : "border-stone-300 bg-transparent"
            }`}
            aria-hidden
          >
            {assignTo === "owner" ? (
              <span className="material-symbols-outlined text-[14px]">check</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onAssignToChange("staff")}
          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
            assignTo === "staff"
              ? "border-primary bg-white ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">
              groups
            </span>
          </span>
          <span>
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign a staff member
            </span>
            <span className="block font-body text-[11px] text-on-surface-variant">
              Pick from your active team.
            </span>
          </span>
        </button>
      </div>

      {assignTo === "staff" ? (
        <div className="mt-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Choose a team member
          </p>
          {staff.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              No active staff members yet. Add team members from the Team
              page.
            </p>
          ) : (
            <div className="mt-2">
              <StaffMemberPicker
                staff={staff}
                value={staffId}
                disabled={disabled}
                onChange={onStaffIdChange}
              />
            </div>
          )}
        </div>
      ) : null}

      <FormActions
        confirmLabel="Assign inspector"
        confirmIcon="person_add"
        disabled={disabled}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function FormActions({
  confirmLabel,
  confirmIcon,
  disabled,
  onCancel,
  onSubmit,
}: {
  confirmLabel: string;
  confirmIcon: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[18px]">
          {disabled ? "progress_activity" : confirmIcon}
        </span>
        {disabled ? "Saving…" : confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}
