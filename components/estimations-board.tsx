"use client";

import Link from "next/link";

export function EstimationsBoard() {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
      <span className="material-symbols-outlined text-[40px] text-outline-variant">
        calculate
      </span>
      <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
        No estimations yet
      </p>
      <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
        Create quick job estimates before sending a formal quotation to your
        customer.
      </p>
      <Link
        href="/dashboard/inspection-visits"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
      >
        <span className="material-symbols-outlined text-[20px]">
          event_available
        </span>
        Inspection visits
      </Link>
    </div>
  );
}
