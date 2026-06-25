"use client";

import { StaffMemberPicker } from "@/components/staff-member-picker";
import { useAuth } from "@/lib/auth/auth-context";
import { useLeaveRequests } from "@/lib/leave/leave-requests-context";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { buildStaffAssignmentBlockMap } from "@/lib/team/staff-assign-blocks";
import { useEffect, useMemo } from "react";

type JobAssignPickerProps = {
  staff: StaffSummary[];
  staffLoading?: boolean;
  assignTo: "owner" | "staff" | null;
  staffId: string;
  disabled?: boolean;
  assignmentDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone?: string | null;
  showUnassigned?: boolean;
  onAssignToChange: (value: "owner" | "staff" | null) => void;
  onStaffIdChange: (value: string) => void;
};

export function JobAssignPicker({
  staff,
  staffLoading = false,
  assignTo,
  staffId,
  disabled = false,
  assignmentDate,
  startTime,
  endTime,
  timeZone,
  showUnassigned = false,
  onAssignToChange,
  onStaffIdChange,
}: JobAssignPickerProps) {
  const { user } = useAuth();
  const { leaveRequests } = useLeaveRequests();
  const ownerAvatar = staffAvatarUrl({
    id: user?.uid ?? "owner",
    fullName: user?.displayName ?? "Business owner",
    email: user?.email ?? "",
  });

  const blockedLabels = useMemo(() => {
    return buildStaffAssignmentBlockMap(
      staff,
      leaveRequests,
      assignmentDate,
      startTime,
      endTime,
      timeZone,
    );
  }, [leaveRequests, staff, assignmentDate, startTime, endTime, timeZone]);

  useEffect(() => {
    if (staffId && blockedLabels[staffId]) onStaffIdChange("");
  }, [staffId, blockedLabels, onStaffIdChange]);

  const optionClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
      active
        ? "border-primary bg-white ring-1 ring-primary/30"
        : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
    }`;

  return (
    <div className="space-y-3">
      {showUnassigned ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAssignToChange(null)}
          className={`${optionClass(assignTo === null)} w-full`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
            <span className="material-symbols-outlined text-[20px]">
              schedule
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign later
            </span>
            <span className="block font-body text-[11px] text-on-surface-variant">
              Create the job now and assign someone from the Jobs board.
            </span>
          </span>
        </button>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAssignToChange("owner")}
          className={optionClass(assignTo === "owner")}
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
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAssignToChange("staff")}
          className={`${optionClass(assignTo === "staff")} items-start`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">groups</span>
          </span>
          <span>
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign a team member
            </span>
            <span className="block font-body text-[11px] text-on-surface-variant">
              Pick from your active team.
            </span>
          </span>
        </button>
      </div>

      {assignTo === "staff" ? (
        <div>
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Choose a team member
          </p>
          {staffLoading ? (
            <p className="mt-2 flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-[18px] text-primary">
                progress_activity
              </span>
              Loading team members…
            </p>
          ) : staff.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              No active staff members yet. Add team members from the Team page.
            </p>
          ) : (
            <div className="mt-2">
              <StaffMemberPicker
                staff={staff}
                value={staffId}
                disabled={disabled}
                blockedLabels={blockedLabels}
                onChange={onStaffIdChange}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
