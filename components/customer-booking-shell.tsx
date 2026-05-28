"use client";

import type { ReactNode } from "react";

/** Fixed bar — stays on screen while content scrolls (no bar background). */
export const CUSTOMER_FIXED_NAV_BAR_CLASS =
  "pointer-events-none fixed inset-x-0 top-0 z-50";

export const CUSTOMER_FIXED_NAV_INNER_CLASS =
  "pointer-events-auto mx-auto w-full max-w-6xl px-3 py-1.5 sm:px-6 sm:py-2.5";

/** Reserves space below the fixed floating pill nav. */
export function CustomerNavSpacer() {
  return (
    <div className="h-[3.5rem] shrink-0 sm:h-[4.75rem]" aria-hidden />
  );
}

/** Shared page chrome for /booknow/[slug] and account sub-routes. */
export function CustomerBookingShell({
  children,
  backdrop,
}: {
  children: ReactNode;
  backdrop?: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#fbf8f3] text-on-surface">
      {backdrop}
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-3 pb-4 pt-0 sm:px-6 sm:pb-10 sm:pt-0">
        {children}
      </div>
    </main>
  );
}

/** White content panel — same width, radius, and minimum height on account tabs. */
export function CustomerShellPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mt-4 flex min-h-[min(72vh,640px)] w-full flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-[24px] sm:p-6 ${className ?? ""}`}
    >
      {children}
    </section>
  );
}
