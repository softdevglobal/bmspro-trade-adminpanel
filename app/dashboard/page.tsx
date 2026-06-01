import { BookingLinkCard } from "@/components/booking-link-card";
import { DashboardShell } from "@/components/dashboard-shell";
import Link from "next/link";

const KPI_CARDS = [
  { label: "Today's bookings", value: "12", icon: "assignment", trend: "+3" },
  { label: "Unassigned", value: "4", icon: "pending_actions", trend: "2 urgent" },
  { label: "Messages", value: "7", icon: "chat", trend: "3 unread" },
  { label: "Partners active", value: "18", icon: "handshake", trend: "All online" },
] as const;

export default function DashboardPage() {
  return (
    <DashboardShell
      title="Dashboard"
      subtitle="Overview of bookings, assignments and messages that need attention."
    >
      <BookingLinkCard variant="ephemeral" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding transition-shadow hover:shadow-[0_4px_20px_rgba(15,23,42,0.05)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="material-symbols-outlined text-[24px] text-primary">
                {card.icon}
              </span>
              <span className="font-body text-[12px] font-semibold text-on-surface-variant">
                {card.trend}
              </span>
            </div>
            <p className="font-display text-[28px] font-bold text-on-surface">
              {card.value}
            </p>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Recent activity
          </h3>
          <ul className="mt-4 space-y-3">
            {[
              "New booking intake — Electrical, Lynbrook",
              "Partner assigned — Plumbing job #1042",
              "Service area validated — 14.2 km from base",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-lg bg-surface-container-low px-3 py-2.5 font-body text-body-md text-on-surface"
              >
                <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary">
                  circle
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Quick actions
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { label: "Add booking", icon: "add", href: "#" },
              { label: "Open calendar", icon: "calendar_month", href: "/dashboard/calendar" },
              { label: "View queue", icon: "list_alt", href: "#" },
              { label: "Team partners", icon: "handshake", href: "#" },
              { label: "Settings", icon: "settings", href: "/dashboard/settings" },
            ].map((action) => {
              const className =
                "flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 font-body text-label-bold text-label-bold text-on-surface transition-colors hover:bg-surface-container";

              if (action.href !== "#") {
                return (
                  <Link key={action.label} href={action.href} className={className}>
                    <span className="material-symbols-outlined text-[20px] text-primary">
                      {action.icon}
                    </span>
                    {action.label}
                  </Link>
                );
              }

              return (
                <button key={action.label} type="button" className={className}>
                  <span className="material-symbols-outlined text-[20px] text-primary">
                    {action.icon}
                  </span>
                  {action.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
