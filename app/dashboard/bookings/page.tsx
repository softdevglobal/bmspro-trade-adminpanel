import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import Link from "next/link";

export default function BookingsPage() {
  return (
    <DashboardShell
      title="Bookings"
      subtitle="Scheduled jobs, assignments and visit status will appear here."
    >
      <BusinessOwnerGuard>
        <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
          <span className="material-symbols-outlined text-[40px] text-outline-variant">
            assignment
          </span>
          <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
            Bookings coming soon
          </p>
          <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
            This board will show confirmed visits and job assignments. For now,
            manage customer requests from Inspection visits.
          </p>
          <Link
            href="/dashboard/inspection-visits"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[20px]">
              event_available
            </span>
            Go to Inspection visits
          </Link>
        </div>
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
