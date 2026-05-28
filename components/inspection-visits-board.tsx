"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  formatAddress,
  formatSlotDate,
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT_LABELS,
  TIME_RANGES,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";

type StaffSummary = {
  id: string;
  fullName: string;
  email: string;
};

type StatusFilter = "all" | InspectionRequestStatus;

const STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending:
    "bg-amber-50 text-amber-700 border border-amber-200",
  owner_proposed:
    "bg-violet-50 text-violet-700 border border-violet-200",
  scheduled:
    "bg-emerald-50 text-emerald-700 border border-emerald-200",
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
  { id: "completed", label: "Completed", shortLabel: "Done" },
  { id: "cancelled", label: "Cancelled", shortLabel: "Cancelled" },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function InspectionVisitsBoard() {
  const { user, status: authStatus } = useAuth();
  const [requests, setRequests] = useState<InspectionRequestDetail[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/inspection-requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        requests?: InspectionRequestDetail[];
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not load requests.");
      }
      setRequests(data.requests ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load requests.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const loadStaff = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/team/staff", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as {
        ok?: boolean;
        staff?: { id: string; fullName: string; email: string; status?: string }[];
      };
      if (!response.ok || !data.ok) return;
      setStaff(
        (data.staff ?? [])
          .filter((member) => member.status !== "suspended")
          .map((member) => ({
            id: member.id,
            fullName: member.fullName,
            email: member.email,
          })),
      );
    } catch {
      /* non-fatal */
    }
  }, [user]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    // Defer to a microtask so initial setState happens outside the effect body.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      await loadRequests();
      if (cancelled) return;
      await loadStaff();
    });
    return () => {
      cancelled = true;
    };
  }, [authStatus, loadRequests, loadStaff]);

  const filtered = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((req) => req.status === filter);
  }, [requests, filter]);

  const counts = useMemo(() => {
    const map: Record<StatusFilter, number> = {
      all: requests.length,
      pending: 0,
      owner_proposed: 0,
      scheduled: 0,
      cancelled: 0,
      completed: 0,
    };
    for (const req of requests) {
      map[req.status] += 1;
    }
    return map;
  }, [requests]);

  const selected = useMemo(
    () => requests.find((req) => req.id === selectedId) ?? null,
    [requests, selectedId],
  );

  function handleUpdated(next: InspectionRequestDetail) {
    setRequests((prev) =>
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

        <button
          type="button"
          onClick={() => void loadRequests()}
          className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container sm:w-auto"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
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
                onOpen={() => setSelectedId(req.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <RequestDetailDrawer
        request={selected}
        staff={staff}
        onClose={() => setSelectedId(null)}
        onUpdated={handleUpdated}
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
}: {
  request: InspectionRequestDetail;
  onOpen: () => void;
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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full min-w-0 max-w-full flex-col gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md sm:p-5 sm:hover:-translate-y-0.5"
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
              <span className="material-symbols-outlined text-[14px] text-primary">
                {request.requestType === "existing_service"
                  ? "format_list_bulleted"
                  : "request_quote"}
              </span>
              {subtitle}
            </span>
          </div>
          <h4 className="mt-2 truncate font-display text-[16px] font-semibold text-on-surface">
            {title}
          </h4>
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
        {request.preferredSlots.slice(0, 3).map((slot, idx) => (
          <SlotPill
            key={`${slot.date}-${slot.timeRange}-${idx}`}
            slot={slot}
            tone="customer"
          />
        ))}
        {request.scheduledSlot ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <span className="material-symbols-outlined text-[14px]">
              event_available
            </span>
            Scheduled · {formatSlotDate(request.scheduledSlot.date)} ·{" "}
            {TIME_RANGE_SHORT_LABELS[request.scheduledSlot.timeRange]}
          </span>
        ) : null}
        {request.assignedTo ? (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary ring-1 ring-primary/15 sm:ml-auto">
            <span className="material-symbols-outlined text-[14px]">
              {request.assignedTo.type === "owner" ? "verified_user" : "person"}
            </span>
            {request.assignedTo.type === "owner"
              ? "Assigned to you"
              : `Assigned to ${request.assignedTo.name}`}
          </span>
        ) : null}
      </div>
    </button>
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
      <span className="material-symbols-outlined shrink-0 text-[14px] text-primary">
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

type DrawerMode = "review" | "accept" | "propose" | "assign";

function RequestDetailDrawer({
  request,
  staff,
  onClose,
  onUpdated,
}: {
  request: InspectionRequestDetail | null;
  staff: StaffSummary[];
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
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 flex h-full w-full max-w-full flex-col bg-surface-container-lowest shadow-2xl sm:max-w-[640px]"
          >
            <DetailDrawerContent
              key={request.id}
              request={request}
              staff={staff}
              onClose={onClose}
              onUpdated={onUpdated}
            />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DetailDrawerContent({
  request,
  staff,
  onClose,
  onUpdated,
}: {
  request: InspectionRequestDetail;
  staff: StaffSummary[];
  onClose: () => void;
  onUpdated: (next: InspectionRequestDetail) => void;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<DrawerMode>("review");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Accept-form state
  const [acceptedSlot, setAcceptedSlot] = useState<InspectionSlot | null>(null);
  const [acceptNote, setAcceptNote] = useState("");

  // Propose-form state
  const [proposedSlots, setProposedSlots] = useState<InspectionSlot[]>([
    { date: "", timeRange: "morning" },
  ]);
  const [proposeNote, setProposeNote] = useState("");

  // Assign-form state
  const [assignTo, setAssignTo] = useState<"owner" | "staff" | null>(null);
  const [staffId, setStaffId] = useState<string>("");

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
      onUpdated(data.request);
      setMode("review");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isClosed =
    request.status === "cancelled" || request.status === "completed";

  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/40 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Inspection request
          </p>
          <h3 className="mt-1 truncate font-display text-[18px] font-semibold text-on-surface">
            {request.requestType === "existing_service"
              ? request.serviceName ?? "Existing service"
              : request.customRequest?.title ?? "Custom quotation request"}
          </h3>
          <span
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-bold uppercase tracking-wider ${STATUS_TONE[request.status]}`}
          >
            {STATUS_LABELS[request.status]}
          </span>
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

      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:space-y-5 sm:px-5 sm:py-5">
        <CustomerSection request={request} />
        <RequestDetailsSection request={request} />
        <SlotsOverview request={request} />
        {request.assignedTo ? <AssignmentSummary request={request} /> : null}
        {request.ownerNote ? (
          <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Owner note
            </p>
            <p className="mt-1 font-body text-body-md text-on-surface">
              {request.ownerNote}
            </p>
          </div>
        ) : null}

        {actionError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
          >
            {actionError}
          </div>
        ) : null}

        {mode === "accept" ? (
          <AcceptForm
            slots={request.preferredSlots}
            value={acceptedSlot}
            note={acceptNote}
            onChange={setAcceptedSlot}
            onNoteChange={setAcceptNote}
            disabled={submitting}
            onCancel={() => setMode("review")}
            onSubmit={() => {
              if (!acceptedSlot) {
                setActionError(
                  "Pick one of the customer's preferred dates to accept.",
                );
                return;
              }
              void callAction({
                action: "accept",
                slot: acceptedSlot,
                note: acceptNote || undefined,
              });
            }}
          />
        ) : null}

        {mode === "propose" ? (
          <ProposeForm
            slots={proposedSlots}
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
      </div>

      {!isClosed && mode === "review" ? (
        <footer className="flex shrink-0 flex-col gap-2 border-t border-outline-variant/40 bg-surface-container-low px-4 py-3 sm:flex-row sm:flex-wrap sm:px-5 sm:py-4">
          {request.status !== "scheduled" ? (
            <>
              <button
                type="button"
                onClick={() => setMode("accept")}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">
                  event_available
                </span>
                Accept a date
              </button>
              <button
                type="button"
                onClick={() => setMode("propose")}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">
                  edit_calendar
                </span>
                Propose new dates
              </button>
            </>
          ) : null}
          {request.status === "scheduled" ? (
            <>
              <button
                type="button"
                onClick={() => setMode("assign")}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">
                  person_add
                </span>
                {request.assignedTo ? "Reassign" : "Assign inspector"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void callAction({ action: "complete" })
                }
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <span className="material-symbols-outlined text-[18px]">
                  task_alt
                </span>
                Mark inspection done
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void callAction({ action: "cancel" })}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:w-auto"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
            Cancel request
          </button>
        </footer>
      ) : null}
    </>
  );
}

/* ==========================================================================
 * Drawer subsections
 * ========================================================================== */

function CustomerSection({ request }: { request: InspectionRequestDetail }) {
  const phoneHref = request.customer.phone
    ? `tel:${request.customer.phone}`
    : null;
  const emailHref = request.customer.email
    ? `mailto:${request.customer.email}`
    : null;

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Customer
      </p>
      <p className="mt-1 font-display text-[15px] font-semibold text-on-surface">
        {request.customer.fullName}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a
          href={phoneHref ?? "#"}
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">
            call
          </span>
          {request.customer.phone || "—"}
        </a>
        <a
          href={emailHref ?? "#"}
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">
            mail
          </span>
          <span className="truncate">{request.customer.email}</span>
        </a>
      </div>
      <p className="mt-3 inline-flex items-start gap-2 font-body text-[13px] text-on-surface">
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
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Service requested
        </p>
        <p className="mt-1 font-display text-[15px] font-semibold text-on-surface">
          {request.serviceName ?? "—"}
        </p>
        {request.serviceBusinessType ? (
          <p className="font-body text-[12px] text-on-surface-variant">
            {request.serviceBusinessType}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Custom quote request
      </p>
      <p className="mt-1 font-display text-[15px] font-semibold text-on-surface">
        {request.customRequest?.title ?? "—"}
      </p>
      {request.customRequest?.description ? (
        <p className="mt-2 whitespace-pre-line font-body text-[13px] leading-relaxed text-on-surface-variant">
          {request.customRequest.description}
        </p>
      ) : null}
    </section>
  );
}

function SlotsOverview({ request }: { request: InspectionRequestDetail }) {
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Customer&apos;s preferred dates
      </p>
      <ul className="mt-2 space-y-1.5">
        {request.preferredSlots.map((slot, idx) => (
          <li
            key={`${slot.date}-${slot.timeRange}-${idx}`}
            className="flex items-center gap-2 font-body text-[13px] text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px] text-primary">
              event
            </span>
            {formatSlotDate(slot.date)} · {TIME_RANGE_LABELS[slot.timeRange]}
          </li>
        ))}
      </ul>

      {request.ownerProposedSlots.length > 0 ? (
        <>
          <p className="mt-4 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Your proposed dates
          </p>
          <ul className="mt-2 space-y-1.5">
            {request.ownerProposedSlots.map((slot, idx) => (
              <li
                key={`${slot.date}-${slot.timeRange}-${idx}`}
                className="flex items-center gap-2 font-body text-[13px] text-violet-700"
              >
                <span className="material-symbols-outlined text-[16px]">
                  edit_calendar
                </span>
                {formatSlotDate(slot.date)} · {TIME_RANGE_LABELS[slot.timeRange]}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {request.scheduledSlot ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Scheduled visit
          </p>
          <p className="mt-1 font-body text-[13px] font-semibold text-emerald-800">
            {formatSlotDate(request.scheduledSlot.date)} ·{" "}
            {TIME_RANGE_LABELS[request.scheduledSlot.timeRange]}
          </p>
        </div>
      ) : null}
    </section>
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
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
        Inspector assigned
      </p>
      <p className="mt-1 font-display text-[15px] font-semibold text-on-surface">
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
 * Action forms
 * ========================================================================== */

function AcceptForm({
  slots,
  value,
  note,
  disabled,
  onChange,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  slots: InspectionSlot[];
  value: InspectionSlot | null;
  note: string;
  disabled: boolean;
  onChange: (slot: InspectionSlot | null) => void;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Accept one of the customer&apos;s dates
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Pick the option that works best — the customer will see this as
        confirmed.
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
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  checked
                    ? "border-primary bg-white ring-1 ring-primary/30"
                    : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
                }`}
              >
                <span className="flex items-center gap-2 font-body text-[13px] font-semibold text-on-surface">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    event
                  </span>
                  {formatSlotDate(slot.date)} ·{" "}
                  {TIME_RANGE_LABELS[slot.timeRange]}
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

function ProposeForm({
  slots,
  note,
  disabled,
  onChange,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  slots: InspectionSlot[];
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
        Add up to 3 alternatives. The customer will see them as your
        suggestions.
      </p>

      <ul className="mt-3 space-y-2">
        {slots.map((slot, index) => (
          <li
            key={index}
            className="rounded-lg border border-outline-variant/60 bg-white p-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
                Option {index + 1}
              </span>
              {slots.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeSlot(index)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-body text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-low"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[160px,1fr]">
              <input
                type="date"
                min={minDate}
                value={slot.date}
                onChange={(event) =>
                  updateSlot(index, "date", event.target.value)
                }
                className="rounded-lg border border-outline-variant/60 bg-white px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
              <div className="grid grid-cols-2 gap-2">
                {TIME_RANGES.map((range) => {
                  const checked = slot.timeRange === range;
                  return (
                    <button
                      type="button"
                      key={range}
                      onClick={() =>
                        updateSlot(index, "timeRange", range as InspectionTimeRange)
                      }
                      className={`rounded-lg border px-2 py-2 font-body text-[12px] font-semibold transition-colors ${
                        checked
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-outline-variant/60 bg-surface-container-lowest text-on-surface hover:border-primary/40"
                      }`}
                    >
                      {TIME_RANGE_SHORT_LABELS[range]}
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
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
          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
            assignTo === "owner"
              ? "border-primary bg-white ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">
              verified_user
            </span>
          </span>
          <span>
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign to me
            </span>
            <span className="block font-body text-[11px] text-on-surface-variant">
              You&apos;ll handle the inspection yourself.
            </span>
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
          {staff.length === 0 ? (
            <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              No active staff members yet. Add team members from the Team
              page.
            </p>
          ) : (
            <select
              value={staffId}
              onChange={(event) => onStaffIdChange(event.target.value)}
              className="w-full rounded-lg border border-outline-variant/60 bg-white px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Select a staff member…</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} {member.email ? `· ${member.email}` : ""}
                </option>
              ))}
            </select>
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
