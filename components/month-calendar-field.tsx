"use client";

import { BookingMonthCalendar } from "@/components/booking-slot-date-picker";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

function formatIsoDateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

/** Click-to-open field that shows the month grid calendar in a popover. */
export function MonthCalendarField({
  selectedIso,
  minDate,
  onSelect,
  label,
  placeholder = "Select date",
  disabled = false,
}: {
  selectedIso: string;
  minDate: string;
  onSelect: (iso: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverStyle(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popoverHeight = popoverRef.current?.offsetHeight ?? 280;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < popoverHeight && spaceAbove > spaceBelow;

      setPopoverStyle({
        position: "fixed",
        left: rect.left,
        width: rect.width,
        top: openAbove ? rect.top - popoverHeight - 4 : rect.bottom + 4,
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
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const popover =
    open && popoverStyle && typeof document !== "undefined"
      ? createPortal(
          <div ref={popoverRef} style={popoverStyle} role="dialog" aria-label="Choose date">
            <BookingMonthCalendar
              selectedIso={selectedIso}
              minDate={minDate}
              onSelect={(iso) => {
                onSelect(iso);
                setOpen(false);
              }}
              className="mt-0 max-w-none shadow-lg ring-1 ring-outline-variant/40"
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      {label ? (
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={`${label ? "mt-0.5" : ""} flex w-full items-center justify-between gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-1.5 font-body text-[13px] text-on-surface transition-colors hover:border-primary/30 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant">
            calendar_month
          </span>
          <span
            className={
              selectedIso ? "text-on-surface" : "text-on-surface-variant/55"
            }
          >
            {selectedIso ? formatIsoDateDisplay(selectedIso) : placeholder}
          </span>
        </span>
        <span className="material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {popover}
    </div>
  );
}
