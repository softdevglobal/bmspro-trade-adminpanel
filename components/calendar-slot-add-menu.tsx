"use client";

import type { HourSlotOccupancy } from "@/lib/calendar/slot-occupancy-types";
import type { CalendarSlotSelection } from "@/lib/calendar/time-slots";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export type CalendarAddEventKind = "inspection" | "personal" | "job";

const MENU_WIDTH_PX = 224;

const ADD_OPTIONS: {
  kind: CalendarAddEventKind;
  label: string;
  hint: string;
  fullHint: string;
  icon: string;
}[] = [
  {
    kind: "inspection",
    label: "Inspection request",
    hint: "Quote or site visit",
    fullHint: "This hour is full for requests",
    icon: "assignment",
  },
  {
    kind: "job",
    label: "Job",
    hint: "Schedule work on site",
    fullHint: "This hour is full for jobs",
    icon: "handyman",
  },
  {
    kind: "personal",
    label: "Personal event",
    hint: "Block time on your calendar",
    fullHint: "Block time on your calendar",
    icon: "event",
  },
];

function isOptionDisabled(
  kind: CalendarAddEventKind,
  occupancy: HourSlotOccupancy | undefined,
  capacityLoading: boolean,
  closedDay: boolean,
  jobsModuleEnabled: boolean,
): boolean {
  if (closedDay) return true;
  if (kind === "personal") return false;
  if (kind === "job" && !jobsModuleEnabled) return true;
  if (capacityLoading || !occupancy) return true;
  return kind === "job" ? occupancy.jobsFull : occupancy.requestsFull;
}

export function CalendarSlotAddMenu({
  slot,
  occupancy,
  capacityLoading = false,
  closedDay = false,
  jobsModuleEnabled = true,
  onSelect,
}: {
  slot: CalendarSlotSelection;
  occupancy?: HourSlotOccupancy;
  capacityLoading?: boolean;
  closedDay?: boolean;
  jobsModuleEnabled?: boolean;
  onSelect: (kind: CalendarAddEventKind, slot: CalendarSlotSelection) => void;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const jobsFull = occupancy?.jobsFull === true;
  const requestsFull = occupancy?.requestsFull === true;
  const allScheduledTypesFull =
    !capacityLoading &&
    occupancy != null &&
    requestsFull &&
    (jobsModuleEnabled ? jobsFull : true);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuStyle(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 220;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const left = Math.min(
        Math.max(8, rect.right - MENU_WIDTH_PX),
        window.innerWidth - MENU_WIDTH_PX - 8,
      );

      setMenuStyle({
        position: "fixed",
        left,
        width: MENU_WIDTH_PX,
        top: openAbove ? rect.top - menuHeight - 6 : rect.bottom + 6,
        zIndex: 9999,
      });
    }

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const menu =
    open && menuStyle && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            style={menuStyle}
            className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg"
          >
            {ADD_OPTIONS.map((option) => {
              const disabled = isOptionDisabled(
                option.kind,
                occupancy,
                capacityLoading,
                closedDay,
                jobsModuleEnabled,
              );
              const moduleDisabled =
                option.kind === "job" && !jobsModuleEnabled;

              return (
                <button
                  key={option.kind}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setOpen(false);
                    onSelect(option.kind, slot);
                  }}
                  className={`flex w-full items-start gap-2.5 border-b border-outline-variant/50 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                    disabled
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-surface-container-low"
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
                    <span className="material-symbols-outlined text-[18px]">
                      {option.icon}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-body text-[13px] font-semibold text-on-surface">
                      {option.label}
                    </span>
                    <span className="block font-body text-[11px] text-on-surface-variant">
                      {closedDay
                        ? "Business off day"
                        : moduleDisabled
                          ? "Enable Jobs in Settings"
                          : disabled && option.kind !== "personal"
                            ? option.fullHint
                            : option.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        disabled={closedDay}
        title={closedDay ? "Business off day" : undefined}
        onClick={() => {
          if (closedDay) return;
          setOpen((current) => !current);
        }}
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-body text-[11px] font-semibold transition-colors ${
          closedDay
            ? "cursor-not-allowed border-outline-variant/60 bg-stone-100 text-outline-variant opacity-60"
            : "border-dashed border-primary/40 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10"
        }`}
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        Add
      </button>
      {allScheduledTypesFull ? (
        <span className="sr-only">
          Jobs and inspection requests are at capacity for this hour. Personal
          events can still be added.
        </span>
      ) : null}
      {menu}
    </div>
  );
}
