"use client";

import { LeaveApprovalDialog } from "@/components/leave-approval-dialog";
import { LeaveRequestsDetailDrawer } from "@/components/leave-requests-detail-drawer";
import { useAuth } from "@/lib/auth/auth-context";
import type { LeaveRequestRecord, LeaveStatus } from "@/lib/leave/types";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useCallback, useEffect, useMemo, useState } from "react";

type Filter = "pending" | "approved" | "rejected" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

function formatDayShort(iso: string | null) {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function statusChipClass(status: LeaveStatus) {
  if (status === "approved") {
    return "border border-tertiary/25 bg-tertiary-container/60 text-on-tertiary-container";
  }
  if (status === "rejected") {
    return "border border-error/25 bg-error-container/60 text-on-error-container";
  }
  return "border border-amber-500/25 bg-amber-50 text-amber-800";
}

function statusLabel(status: LeaveStatus) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

export function LeaveRequestsBoard() {
  const { user } = useAuth();
  const { staff } = useBusinessStaffSummary();
  const [items, setItems] = useState<LeaveRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRecord | null>(
    null,
  );
  const [approveTarget, setApproveTarget] = useState<LeaveRequestRecord | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/leave-requests", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        leaveRequests?: LeaveRequestRecord[];
      };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error ?? "Could not load leave requests.");
      }
      setItems(payload.leaveRequests ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load leave requests.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result = { pending: 0, approved: 0, rejected: 0, all: items.length };
    for (const item of items) result[item.status] += 1;
    return result;
  }, [items]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.status === filter);
  }, [items, filter]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function decide(
    id: string,
    action: "approve" | "reject",
    reason?: string,
  ) {
    if (!user) return;
    setBusyId(id);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/leave-requests/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          action === "approve" ? { action } : { action, reason },
        ),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        leaveRequest?: LeaveRequestRecord;
      };
      if (!response.ok || payload.ok !== true || !payload.leaveRequest) {
        throw new Error(payload.error ?? "Could not update the request.");
      }
      const updated = payload.leaveRequest;
      setItems((current) =>
        current.map((item) => (item.id === id ? updated : item)),
      );
      setSelectedId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the request.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function openReject(item: LeaveRequestRecord) {
    setRejectTarget(item);
    setRejectReason("");
  }

  function openApprove(item: LeaveRequestRecord) {
    setApproveTarget(item);
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Pending"
            value={String(counts.pending)}
            active={filter === "pending"}
            onClick={() => {
              setFilter("pending");
              setSelectedId(null);
            }}
            tone="amber"
          />
          <StatCard
            label="Approved"
            value={String(counts.approved)}
            active={filter === "approved"}
            onClick={() => {
              setFilter("approved");
              setSelectedId(null);
            }}
            tone="green"
          />
          <StatCard
            label="Rejected"
            value={String(counts.rejected)}
            active={filter === "rejected"}
            onClick={() => {
              setFilter("rejected");
              setSelectedId(null);
            }}
            tone="rose"
          />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((tab) => {
              const active = filter === tab.id;
              const count = counts[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setFilter(tab.id);
                    setSelectedId(null);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-primary bg-primary text-on-primary shadow-sm"
                      : "border-outline-variant/70 bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                      active
                        ? "bg-on-primary/20 text-on-primary"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-outline-variant/70 bg-surface-container-low px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                loading ? "animate-spin" : ""
              }`}
            >
              refresh
            </span>
            Refresh
          </button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
              error
            </span>
            {error}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-outline-variant/60 bg-surface-container-lowest font-body text-body-md text-on-surface-variant">
            <span className="material-symbols-outlined mr-2 animate-spin text-[22px] text-primary">
              progress_activity
            </span>
            Loading leave requests…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant/70 bg-surface-container-low px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-container/30 text-primary">
              <span className="material-symbols-outlined text-[28px]">
                beach_access
              </span>
            </span>
            <p className="mt-4 font-display text-[18px] font-semibold text-on-surface">
              {filter === "pending"
                ? "No pending leave requests"
                : "Nothing to show here"}
            </p>
            <p className="mt-2 max-w-sm font-body text-[14px] text-on-surface-variant">
              When your team submits time off from the mobile app, it appears
              here for you to approve or decline.
            </p>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <p className="font-body text-[12px] text-on-surface-variant">
              {visible.length} request{visible.length === 1 ? "" : "s"} · tap a
              row to open the side preview
            </p>

            <ul className="space-y-3">
              {visible.map((item) => (
                <li key={item.id}>
                  <LeaveRequestRow
                    item={item}
                    selected={selectedId === item.id}
                    onSelect={() => setSelectedId(item.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <LeaveRequestsDetailDrawer
        item={selectedItem}
        busyId={busyId}
        onClose={() => setSelectedId(null)}
        onApprove={(item) => openApprove(item)}
        onReject={openReject}
        onViewAttachment={setPreviewUrl}
      />

      {approveTarget ? (
        <LeaveApprovalDialog
          item={approveTarget}
          staff={staff}
          busy={busyId === approveTarget.id}
          getToken={async () => {
            if (!user) throw new Error("Not signed in.");
            return user.getIdToken();
          }}
          onClose={() => setApproveTarget(null)}
          onApproved={(updated) => {
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setApproveTarget(null);
            setSelectedId(null);
          }}
          onError={(message) => setError(message)}
        />
      ) : null}

      {rejectTarget ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5 shadow-xl">
            <h4 className="font-display text-title-lg font-semibold text-on-surface">
              Decline this request?
            </h4>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {rejectTarget.requesterName} will see your note in the app.
            </p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              placeholder="Write a clear reason…"
              className="mt-3 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface outline-none focus:border-primary"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  rejectReason.trim().length < 2 || busyId === rejectTarget.id
                }
                onClick={async () => {
                  const target = rejectTarget;
                  setRejectTarget(null);
                  await decide(target.id, "reject", rejectReason.trim());
                }}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-error px-4 font-body text-[13px] font-semibold text-on-error transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reject request
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewUrl ? (
        <button
          type="button"
          onClick={() => setPreviewUrl(null)}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Leave attachment"
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        </button>
      ) : null}
    </>
  );
}

function StatCard({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
  tone: "amber" | "green" | "rose";
}) {
  const toneClass =
    tone === "amber"
      ? active
        ? "border-amber-400/50 bg-amber-50 ring-2 ring-amber-400/20"
        : "border-outline-variant/60 bg-surface-container-lowest hover:border-amber-300/50"
      : tone === "green"
        ? active
          ? "border-tertiary/40 bg-tertiary-container/30 ring-2 ring-tertiary/15"
          : "border-outline-variant/60 bg-surface-container-lowest hover:border-tertiary/30"
        : active
          ? "border-error/30 bg-error-container/30 ring-2 ring-error/10"
          : "border-outline-variant/60 bg-surface-container-lowest hover:border-error/25";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition-all ${toneClass}`}
    >
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className="mt-1 font-display text-[1.75rem] font-semibold leading-none text-on-surface">
        {value}
      </p>
    </button>
  );
}

function LeaveRequestRow({
  item,
  selected,
  onSelect,
}: {
  item: LeaveRequestRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const sameDay = item.fromDate && item.fromDate === item.toDate;
  const dateLabel = sameDay
    ? formatDayShort(item.fromDate)
    : `${formatDayShort(item.fromDate)} → ${formatDayShort(item.toDate)}`;
  const avatar = staffAvatarUrl({
    id: item.requesterUid,
    fullName: item.requesterName,
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-center gap-4 rounded-2xl border bg-surface-container-lowest p-4 text-left shadow-sm transition-all ${
        selected
          ? "border-primary/40 ring-2 ring-primary/15"
          : "border-outline-variant/60 hover:border-primary/25 hover:shadow-md"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatar}
        alt=""
        className="h-12 w-12 shrink-0 rounded-xl border border-outline-variant/60 bg-white object-cover"
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-display text-[16px] font-semibold text-on-surface">
            {item.requesterName}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide ${statusChipClass(item.status)}`}
          >
            {statusLabel(item.status)}
          </span>
        </span>

        <span className="mt-1 block truncate font-body text-[13px] text-on-surface-variant">
          {item.requesterRole?.trim() || "Staff member"}
        </span>

        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-[12px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1 font-medium text-on-surface">
            <span className="material-symbols-outlined text-[15px] text-primary">
              event
            </span>
            {dateLabel}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">
              {item.isFullDay ? "wb_sunny" : "schedule"}
            </span>
            {item.isFullDay
              ? "Full day"
              : `${item.startTime ?? "—"} – ${item.endTime ?? "—"}`}
          </span>
        </span>
      </span>

      <span
        className={`material-symbols-outlined shrink-0 text-[22px] transition-colors ${
          selected ? "text-primary" : "text-on-surface-variant group-hover:text-primary"
        }`}
        aria-hidden
      >
        chevron_right
      </span>
    </button>
  );
}
