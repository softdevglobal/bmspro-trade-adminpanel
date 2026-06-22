"use client";

import {
  formatWorkingDuration,
  type AttendanceBreakPeriod,
} from "@/lib/team/attendance";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

export type AttendanceDetailRecord = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  status: string;
  workingSeconds: number;
  totalBreakSeconds: number;
  breakPeriods: AttendanceBreakPeriod[];
};

type Props = {
  record: AttendanceDetailRecord | null;
  selectedDateLabel: string;
  onClose: () => void;
};

const panelTransition = {
  type: "spring" as const,
  damping: 32,
  stiffness: 340,
  mass: 0.85,
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (status === "checked_in") return "Active";
  if (status === "auto_checked_out") return "Auto checked out";
  return "Done";
}

function statusBadgeClass(status: string) {
  if (status === "checked_in") {
    return "border border-primary/20 bg-primary-fixed text-on-primary-fixed-variant";
  }
  if (status === "auto_checked_out") {
    return "border border-amber-500/20 bg-amber-500/10 text-amber-700";
  }
  return "border border-outline-variant/40 bg-surface-container-high text-on-surface-variant";
}

export function TeamAttendanceDetailDrawer({
  record,
  selectedDateLabel,
  onClose,
}: Props) {
  const open = record !== null;
  useRegisterRightDrawer(open, "md");

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
      {record ? (
        <DrawerPanel
          key={record.id}
          record={record}
          selectedDateLabel={selectedDateLabel}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>
  );
}

function DrawerPanel({
  record,
  selectedDateLabel,
  onClose,
}: {
  record: AttendanceDetailRecord;
  selectedDateLabel: string;
  onClose: () => void;
}) {
  const avatar = staffAvatarUrl({
    id: record.staffId,
    fullName: record.staffName,
  });

  return (
    <div className="fixed inset-0 z-[100]">
      <motion.button
        type="button"
        aria-label="Close attendance details"
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
        aria-labelledby="attendance-detail-title"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={panelTransition}
        className="absolute inset-y-0 right-0 flex w-[calc(100%-1.25rem)] max-w-[512px] flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-outline-variant bg-background shadow-2xl will-change-transform sm:w-full sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l"
      >
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.28, ease: "easeOut" }}
          className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant px-5 py-4"
        >
          <div className="flex min-w-0 items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatar}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl border border-outline-variant bg-white object-cover"
            />
            <div className="min-w-0">
              <h2
                id="attendance-detail-title"
                className="truncate font-display text-headline-sm font-semibold text-on-surface"
              >
                {record.staffName}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
                {record.staffRole?.trim() || "Staff"}
              </p>
              <span
                className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold uppercase ${statusBadgeClass(record.status)}`}
              >
                {statusLabel(record.status)}
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
        </motion.header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <DetailSection title="Day">
            <DetailRow label="Date" value={selectedDateLabel} />
          </DetailSection>

          <DetailSection title="Times">
            <DetailRow
              label="Clock in"
              value={formatDateTime(record.checkInTime)}
            />
            <DetailRow
              label="Clock out"
              value={formatDateTime(record.checkOutTime)}
            />
          </DetailSection>

          <DetailSection title="Summary">
            <DetailRow
              label="Worked"
              value={formatWorkingDuration(record.workingSeconds)}
            />
            <DetailRow
              label="Break"
              value={
                record.totalBreakSeconds > 0
                  ? formatWorkingDuration(record.totalBreakSeconds)
                  : "—"
              }
            />
          </DetailSection>

          <DetailSection title="Break periods">
            {record.breakPeriods.length === 0 ? (
              <p className="px-4 py-3 font-body text-[13px] text-on-surface-variant">
                No breaks recorded for this shift.
              </p>
            ) : (
              record.breakPeriods.map((breakPeriod, index) => (
                <div
                  key={`${breakPeriod.startTime}-${index}`}
                  className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <dt className="font-body text-[12px] font-semibold text-on-surface-variant">
                    Break {index + 1}
                  </dt>
                  <dd className="font-body text-[13px] text-on-surface sm:text-right">
                    {formatTime(breakPeriod.startTime)} –{" "}
                    {breakPeriod.endTime
                      ? formatTime(breakPeriod.endTime)
                      : "In progress"}
                    <span className="mt-0.5 block text-[12px] text-on-surface-variant">
                      {formatWorkingDuration(breakPeriod.durationSeconds)}
                    </span>
                  </dd>
                </div>
              ))
            )}
          </DetailSection>
        </div>
      </motion.aside>
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
