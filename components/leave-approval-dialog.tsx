"use client";

import { StaffMemberPicker } from "@/components/staff-member-picker";
import { buildStaffAssignmentBlockMap } from "@/lib/team/staff-assign-blocks";
import type {
  LeaveAssignmentConflict,
  LeaveReassignment,
  LeaveRequestRecord,
} from "@/lib/leave/types";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useLeaveRequests } from "@/lib/leave/leave-requests-context";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";
import { useEffect, useMemo, useState } from "react";

function formatDayShort(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

type ReassignDraft = {
  assignTo: "owner" | "staff";
  staffId: string;
};

export function LeaveApprovalDialog({
  item,
  staff,
  busy,
  getToken,
  onClose,
  onApproved,
  onError,
}: {
  item: LeaveRequestRecord;
  staff: StaffSummary[];
  busy: boolean;
  getToken: () => Promise<string>;
  onClose: () => void;
  onApproved: (leave: LeaveRequestRecord) => void;
  onError: (message: string) => void;
}) {
  const [conflicts, setConflicts] = useState<LeaveAssignmentConflict[] | null>(
    null,
  );
  const [loadingConflicts, setLoadingConflicts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReassignDraft>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingConflicts(true);
      try {
        const token = await getToken();
        const response = await fetch(`/api/leave-requests/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          conflicts?: LeaveAssignmentConflict[];
          error?: string;
        };
        if (!response.ok || payload.ok !== true) {
          throw new Error(payload.error ?? "Could not load schedule conflicts.");
        }
        if (!cancelled) {
          const list = payload.conflicts ?? [];
          setConflicts(list);
          const initial: Record<string, ReassignDraft> = {};
          for (const conflict of list) {
            initial[`${conflict.kind}:${conflict.id}`] = {
              assignTo: "owner",
              staffId: "",
            };
          }
          setDrafts(initial);
        }
      } catch (err) {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? err.message
              : "Could not load schedule conflicts.",
          );
          onClose();
        }
      } finally {
        if (!cancelled) setLoadingConflicts(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [getToken, item.id, onClose, onError]);

  const hasConflicts = (conflicts?.length ?? 0) > 0;

  async function submit() {
    const reassignments: LeaveReassignment[] = [];
    if (hasConflicts && conflicts) {
      for (const conflict of conflicts) {
        const key = `${conflict.kind}:${conflict.id}`;
        const draft = drafts[key];
        if (!draft) {
          onError("Choose who should cover every conflicting job and visit.");
          return;
        }
        if (draft.assignTo === "staff" && !draft.staffId) {
          onError("Choose a team member for each reassignment.");
          return;
        }
        reassignments.push({
          kind: conflict.kind,
          id: conflict.id,
          assignTo: draft.assignTo,
          staffId: draft.assignTo === "staff" ? draft.staffId : undefined,
        });
      }
    }

    try {
      setSubmitting(true);
      const token = await getToken();
      const response = await fetch(`/api/leave-requests/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "approve",
          reassignments: reassignments.length > 0 ? reassignments : undefined,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        leaveRequest?: LeaveRequestRecord;
      };
      if (!response.ok || payload.ok !== true || !payload.leaveRequest) {
        throw new Error(payload.error ?? "Could not approve leave.");
      }
      onApproved(payload.leaveRequest);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Could not approve leave.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest shadow-xl">
        <div className="shrink-0 border-b border-outline-variant/60 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tertiary-container/70 text-on-tertiary-container">
              <span className="material-symbols-outlined text-[22px]">
                check_circle
              </span>
            </span>
            <div className="min-w-0">
              <h4 className="font-display text-title-lg font-semibold text-on-surface">
                Approve leave for {item.requesterName}?
              </h4>
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                {hasConflicts
                  ? "Reassign conflicting jobs and visits before approving."
                  : "They will be blocked from new assignments on the approved days."}
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loadingConflicts ? (
            <p className="font-body text-[13px] text-on-surface-variant">
              Checking scheduled work…
            </p>
          ) : hasConflicts ? (
            <ul className="space-y-3">
              {conflicts?.map((conflict) => (
                <ConflictReassignRow
                  key={`${conflict.kind}:${conflict.id}`}
                  conflict={conflict}
                  staff={staff}
                  leaveRequesterUid={item.requesterUid}
                  draft={
                    drafts[`${conflict.kind}:${conflict.id}`] ?? {
                      assignTo: "owner",
                      staffId: "",
                    }
                  }
                  onChange={(next) =>
                    setDrafts((current) => ({
                      ...current,
                      [`${conflict.kind}:${conflict.id}`]: next,
                    }))
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-tertiary/20 bg-tertiary-container/30 px-4 py-3 font-body text-[13px] text-on-tertiary-container">
              No scheduled jobs or visits conflict with this leave.
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/60 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy || submitting}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || submitting || loadingConflicts}
            onClick={() => void submit()}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-tertiary px-4 font-body text-[13px] font-semibold text-on-tertiary transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              check_circle
            </span>
            {hasConflicts ? "Reassign & approve" : "Approve leave"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConflictReassignRow({
  conflict,
  staff,
  leaveRequesterUid,
  draft,
  onChange,
}: {
  conflict: LeaveAssignmentConflict;
  staff: StaffSummary[];
  leaveRequesterUid: string;
  draft: ReassignDraft;
  onChange: (draft: ReassignDraft) => void;
}) {
  const { leaveRequests } = useLeaveRequests();
  const business = useBusinessProfile();
  const eligibleStaff = useMemo(
    () => staff.filter((member) => member.id !== leaveRequesterUid),
    [staff, leaveRequesterUid],
  );

  const blockedLabels = useMemo(
    () =>
      buildStaffAssignmentBlockMap(
        eligibleStaff,
        leaveRequests,
        conflict.scheduledDate,
        conflict.scheduledStartTime,
        conflict.scheduledEndTime,
        business?.timezone,
      ),
    [leaveRequests, eligibleStaff, conflict, business?.timezone],
  );

  return (
    <li className="rounded-xl border border-amber-500/25 bg-amber-50/80 p-3">
      <p className="font-body text-[13px] font-semibold text-amber-900">
        {conflict.kind === "job" ? "Job" : "Visit"}: {conflict.label}
      </p>
      <p className="mt-0.5 font-body text-[12px] text-amber-800/90">
        {formatDayShort(conflict.scheduledDate)}
        {conflict.customerName ? ` · ${conflict.customerName}` : ""}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange({ assignTo: "owner", staffId: "" })}
          className={`rounded-lg border px-3 py-2 text-left font-body text-[12px] font-semibold transition-colors ${
            draft.assignTo === "owner"
              ? "border-primary bg-white text-on-surface ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-white/70 text-on-surface-variant hover:border-primary/40"
          }`}
        >
          Assign to me
        </button>
        <button
          type="button"
          onClick={() => onChange({ assignTo: "staff", staffId: draft.staffId })}
          className={`rounded-lg border px-3 py-2 text-left font-body text-[12px] font-semibold transition-colors ${
            draft.assignTo === "staff"
              ? "border-primary bg-white text-on-surface ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-white/70 text-on-surface-variant hover:border-primary/40"
          }`}
        >
          Assign staff member
        </button>
      </div>

      {draft.assignTo === "staff" ? (
        <div className="mt-2">
          <StaffMemberPicker
            staff={eligibleStaff}
            value={draft.staffId}
            disabled={false}
            blockedLabels={blockedLabels}
            onChange={(staffId) => onChange({ assignTo: "staff", staffId })}
          />
        </div>
      ) : null}
    </li>
  );
}
