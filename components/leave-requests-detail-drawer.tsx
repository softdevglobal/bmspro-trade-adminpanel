"use client";

import type { LeaveRequestRecord, LeaveStatus } from "@/lib/leave/types";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

const panelTransition = {
  type: "spring" as const,
  damping: 32,
  stiffness: 340,
  mass: 0.85,
};

function formatDay(iso: string | null) {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatSubmitted(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dayCount(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return null;
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function statusLabel(status: LeaveStatus) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function statusBadgeClass(status: LeaveStatus) {
  if (status === "approved") {
    return "border border-tertiary/20 bg-tertiary-container/70 text-on-tertiary-container";
  }
  if (status === "rejected") {
    return "border border-error/20 bg-error-container/70 text-on-error-container";
  }
  return "border border-amber-500/20 bg-amber-100 text-amber-800";
}

/** Right-side slide-over drawer for leave request details and actions. */
export function LeaveRequestsDetailDrawer({
  item,
  busyId,
  onClose,
  onApprove,
  onReject,
  onViewAttachment,
}: {
  item: LeaveRequestRecord | null;
  busyId: string | null;
  onClose: () => void;
  onApprove: (item: LeaveRequestRecord) => void;
  onReject: (item: LeaveRequestRecord) => void;
  onViewAttachment: (url: string) => void;
}) {
  const open = item !== null;
  useRegisterRightDrawer(open, "sm");

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence mode="wait">
      {item ? (
        <div key={item.id} className="fixed inset-0 z-[100]">
          <motion.button
            type="button"
            aria-label="Close leave request details"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-detail-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={panelTransition}
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-[520px] flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-background shadow-2xl will-change-transform sm:max-w-[520px]"
          >
            <LeaveRequestPreviewContent
              item={item}
              busyId={busyId}
              onClose={onClose}
              onApprove={onApprove}
              onReject={onReject}
              onViewAttachment={onViewAttachment}
            />
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function LeaveRequestPreviewContent({
  item,
  busyId,
  onClose,
  onApprove,
  onReject,
  onViewAttachment,
}: {
  item: LeaveRequestRecord;
  busyId: string | null;
  onClose: () => void;
  onApprove: (item: LeaveRequestRecord) => void;
  onReject: (item: LeaveRequestRecord) => void;
  onViewAttachment: (url: string) => void;
}) {
  const avatar = staffAvatarUrl({
    id: item.requesterUid,
    fullName: item.requesterName,
  });
  const sameDay = item.fromDate && item.fromDate === item.toDate;
  const days = dayCount(item.fromDate, item.toDate);
  const busy = busyId === item.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 bg-surface-container-low/50 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatar}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl border border-outline-variant bg-white object-cover"
          />
          <div className="min-w-0">
            <h2
              id="leave-detail-title"
              className="truncate font-display text-[18px] font-semibold text-on-surface"
            >
              {item.requesterName}
            </h2>
            <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
              {item.requesterRole?.trim() || "Staff member"}
            </p>
            <span
              className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold uppercase ${statusBadgeClass(item.status)}`}
            >
              {statusLabel(item.status)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <DetailSection title="Time off">
          <DetailRow label="From" value={formatDay(item.fromDate)} />
          <DetailRow
            label="To"
            value={sameDay ? "Same day" : formatDay(item.toDate)}
          />
          {days != null && days > 1 ? (
            <DetailRow label="Duration" value={`${days} days`} />
          ) : null}
          <DetailRow
            label="Each day"
            value={
              item.isFullDay
                ? "Full day"
                : `${item.startTime ?? "—"} – ${item.endTime ?? "—"}`
            }
          />
        </DetailSection>

        <DetailSection title="Request">
          <DetailRow
            label="Reason"
            value={item.reason?.trim() || "No reason provided"}
          />
          <DetailRow
            label="Submitted"
            value={formatSubmitted(item.createdAtIso)}
          />
        </DetailSection>

        {item.attachmentUrl ? (
          <section className="mb-6">
            <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Attachment
            </h3>
            <button
              type="button"
              onClick={() => onViewAttachment(item.attachmentUrl!)}
              className="group block w-full overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest text-left transition-colors hover:border-primary/30"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.attachmentUrl}
                alt="Leave attachment"
                className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <span className="flex items-center gap-2 px-4 py-3 font-body text-[13px] font-semibold text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  zoom_in
                </span>
                View full image
              </span>
            </button>
          </section>
        ) : null}

        {item.status === "rejected" && item.rejectionReason ? (
          <section className="mb-6">
            <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Decline reason
            </h3>
            <p className="rounded-xl border border-error/20 bg-error-container/40 px-4 py-3 font-body text-[13px] text-on-error-container">
              {item.rejectionReason}
            </p>
          </section>
        ) : null}

        {item.status === "pending" ? (
          <section className="mb-6 rounded-xl border border-amber-500/25 bg-amber-50/80 px-4 py-3">
            <p className="font-body text-[13px] text-amber-900">
              <span className="material-symbols-outlined mr-1 align-middle text-[16px]">
                warning
              </span>
              If this person is assigned to jobs or visits on these days, you
              must reassign that work before approving leave.
            </p>
          </section>
        ) : null}

        {item.status === "approved" ? (
          <section className="rounded-xl border border-tertiary/20 bg-tertiary-container/30 px-4 py-3">
            <p className="font-body text-[13px] text-on-tertiary-container">
              <span className="material-symbols-outlined mr-1 align-middle text-[16px]">
                info
              </span>
              This staff member cannot be assigned to jobs or requests on these
              days.
            </p>
          </section>
        ) : null}
      </div>

      {item.status === "pending" ? (
        <div className="flex shrink-0 gap-2 border-t border-outline-variant/60 bg-surface-container-lowest px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(item)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-tertiary px-4 font-body text-[13px] font-semibold text-on-tertiary transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              check_circle
            </span>
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(item)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-error/40 bg-error-container/40 px-4 font-body text-[13px] font-semibold text-on-error-container transition-colors hover:bg-error-container/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">cancel</span>
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </h3>
      <dl className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
        {children}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="font-body text-[12px] font-semibold text-on-surface-variant">
        {label}
      </dt>
      <dd className="font-body text-[13px] text-on-surface sm:max-w-[58%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}
