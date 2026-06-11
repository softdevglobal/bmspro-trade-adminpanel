"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";

export type BookingAssignChoice = "owner" | "staff";

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

export function BookingStaffAssignSection({
  staff,
  choice,
  staffId,
  disabled,
  onChoiceChange,
  onStaffIdChange,
}: {
  staff: StaffSummary[];
  choice: BookingAssignChoice;
  staffId: string;
  disabled?: boolean;
  onChoiceChange: (choice: BookingAssignChoice) => void;
  onStaffIdChange: (staffId: string) => void;
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
        Assign this job
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Choose who will run the job.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoiceChange("owner")}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            choice === "owner"
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
              choice === "owner"
                ? "border-primary bg-primary text-on-primary"
                : "border-stone-300 bg-transparent"
            }`}
            aria-hidden
          >
            {choice === "owner" ? (
              <span className="material-symbols-outlined text-[14px]">check</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoiceChange("staff")}
          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            choice === "staff"
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

      {choice === "staff" ? (
        <div className="mt-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Choose a team member
          </p>
          {staff.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              No active staff members yet. Add team members from the Team page,
              or assign the job to yourself.
            </p>
          ) : (
            <div className="mt-2">
              <StaffMemberPicker
                staff={staff}
                value={staffId}
                disabled={Boolean(disabled)}
                onChange={onStaffIdChange}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
