"use client";

import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";

function StaffQuotationAccessBadge({
  cangetQuotation,
}: {
  cangetQuotation: boolean;
}) {
  return (
    <span
      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[10px] font-semibold ${
        cangetQuotation
          ? "border border-tertiary/25 bg-tertiary-container/50 text-on-tertiary-container"
          : "border border-amber-500/25 bg-amber-50 text-amber-800"
      }`}
    >
      <span className="material-symbols-outlined material-symbols-filled text-[12px]">
        {cangetQuotation ? "request_quote" : "error"}
      </span>
      {cangetQuotation ? "Can get quotation" : "Quotation creation Not allowed"}
    </span>
  );
}

export function StaffMemberPicker({
  staff,
  value,
  disabled,
  onChange,
  blockedLabels = {},
  showQuotationAccess = false,
}: {
  staff: StaffSummary[];
  value: string;
  disabled: boolean;
  onChange: (staffId: string) => void;
  blockedLabels?: Record<string, string>;
  showQuotationAccess?: boolean;
}) {
  return (
    <ul className="max-h-[min(16rem,42vh)] space-y-2 overflow-y-auto pr-0.5">
      {staff.map((member) => {
        const selected = value === member.id;
        const blockLabel = blockedLabels[member.id];
        const onLeave = Boolean(blockLabel);
        const rowDisabled = disabled || onLeave;

        return (
          <li key={member.id}>
            <button
              type="button"
              disabled={rowDisabled}
              aria-disabled={rowDisabled}
              title={onLeave ? blockLabel : undefined}
              onClick={() => {
                if (!onLeave) onChange(member.id);
              }}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                onLeave
                  ? "border-outline-variant/50 bg-surface-container-low/80 opacity-70"
                  : rowDisabled
                    ? "opacity-60"
                    : selected
                      ? "border-primary bg-white ring-1 ring-primary/30"
                      : "border-outline-variant/60 bg-white hover:border-primary/40 hover:bg-primary/[0.03]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={staffAvatarUrl(member)}
                alt=""
                className={`h-11 w-11 shrink-0 rounded-full border-2 border-white bg-surface-container-low object-cover shadow-sm ring-1 ring-outline-variant/30 ${
                  onLeave ? "grayscale-[0.35]" : ""
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-body text-[13px] font-semibold text-on-surface">
                    {member.fullName}
                  </span>
                  {onLeave ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-50 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      <span className="material-symbols-outlined text-[12px]">
                        beach_access
                      </span>
                      {blockLabel}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate font-body text-[11px] text-on-surface-variant">
                  {member.staffType}
                  {member.email ? ` · ${member.email}` : ""}
                </span>
                {showQuotationAccess ? (
                  <StaffQuotationAccessBadge
                    cangetQuotation={member.canget_qutaion}
                  />
                ) : null}
              </span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  onLeave
                    ? "border-outline-variant/60 bg-surface-container-high text-on-surface-variant"
                    : selected
                      ? "border-primary bg-primary text-on-primary"
                      : "border-stone-300 bg-white text-transparent"
                }`}
                aria-hidden
              >
                {onLeave ? (
                  <span className="material-symbols-outlined text-[14px]">
                    block
                  </span>
                ) : selected ? (
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
