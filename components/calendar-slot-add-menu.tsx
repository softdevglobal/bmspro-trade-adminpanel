"use client";

import type { CalendarSlotSelection } from "@/lib/calendar/time-slots";
import { useEffect, useId, useRef, useState } from "react";

export type CalendarAddEventKind = "inspection" | "personal" | "job";

const ADD_OPTIONS: {
  kind: CalendarAddEventKind;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    kind: "inspection",
    label: "Inspection request",
    hint: "Quote or site visit",
    icon: "assignment",
  },
  {
    kind: "job",
    label: "Job",
    hint: "Schedule work on site",
    icon: "handyman",
  },
  {
    kind: "personal",
    label: "Personal event",
    hint: "Block time on your calendar",
    icon: "event",
  },
];

export function CalendarSlotAddMenu({
  slot,
  onSelect,
}: {
  slot: CalendarSlotSelection;
  onSelect: (kind: CalendarAddEventKind, slot: CalendarSlotSelection) => void;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2 py-1 font-body text-[11px] font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/10"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        Add
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg"
        >
          {ADD_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(option.kind, slot);
              }}
              className="flex w-full items-start gap-2.5 border-b border-outline-variant/50 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-container-low"
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
                  {option.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
