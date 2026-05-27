import { DashboardShell } from "@/components/dashboard-shell";

const SETTINGS_CARDS = [
  {
    title: "Business Profile",
    description: "Update your company info, logo, and contact details.",
    icon: "store",
    iconClass: "bg-primary/10 text-primary",
  },
  {
    title: "Calendar Settings",
    description: "Manage sync intervals, view formats, and timezones.",
    icon: "calendar_today",
    iconClass: "bg-tertiary/10 text-tertiary",
  },
  {
    title: "Services",
    description: "Define your trade offerings, pricing, and durations.",
    icon: "handyman",
    iconClass: "bg-secondary/10 text-secondary",
  },
  {
    title: "Team & Partners",
    description: "Manage internal staff accounts and access levels.",
    icon: "badge",
    iconClass: "bg-primary/10 text-primary",
  },
  {
    title: "Availability",
    description: "Set standard working hours and holiday blackout dates.",
    icon: "schedule",
    iconClass: "bg-tertiary-container/20 text-tertiary",
  },
  {
    title: "Booking Rules",
    description: "Define lead times, cancellation policies, and deposits.",
    icon: "gavel",
    iconClass: "bg-error/10 text-error",
  },
  {
    title: "Contractor Connections",
    description: "Link external contractors for overflow job handling.",
    icon: "hub",
    iconClass: "bg-secondary/10 text-secondary",
  },
  {
    title: "Partner Connections",
    description: "Connect with supply vendors and insurance providers.",
    icon: "handshake",
    iconClass: "bg-primary/10 text-primary",
  },
  {
    title: "Notifications",
    description: "Configure SMS, email, and app push notification triggers.",
    icon: "notifications_active",
    iconClass: "bg-tertiary/10 text-tertiary",
  },
  {
    title: "App Preferences",
    description: "Language settings, theme mode, and accessibility options.",
    icon: "settings_suggest",
    iconClass: "bg-outline/10 text-outline",
  },
] as const;

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      subtitle="Basic setup for bookings, calendar, services and team."
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-outline px-6 py-3 font-body text-label-bold text-label-bold text-on-surface transition-colors hover:bg-surface-container-high"
          >
            Discard Changes
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-label-bold text-on-primary transition-all hover:bg-primary/90 active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            Save Changes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {SETTINGS_CARDS.map((card) => (
          <div
            key={card.title}
            className="group flex flex-col justify-between rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding transition-all hover:shadow-lg"
          >
            <div>
              <div
                className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg transition-transform group-hover:scale-110 ${card.iconClass}`}
              >
                <span className="material-symbols-outlined">{card.icon}</span>
              </div>
              <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
                {card.title}
              </h3>
              <p className="mb-6 mt-2 font-body text-body-md text-on-surface-variant">
                {card.description}
              </p>
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-4 py-2 font-body text-label-bold text-label-bold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              Open
              <span className="material-symbols-outlined text-[18px]">
                chevron_right
              </span>
            </button>
          </div>
        ))}

        <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-primary/20 bg-primary-container p-card-padding transition-all hover:shadow-lg md:col-span-2 lg:col-span-1 xl:col-span-2">
          <div className="relative z-10">
            <h3 className="font-display text-display-md text-on-primary-container">
              Need help?
            </h3>
            <p className="mb-6 mt-2 max-w-xs font-body text-body-lg text-on-primary-container/80">
              Our master technicians are available 24/7 to help you optimize
              your trade workflow.
            </p>
            <button
              type="button"
              className="rounded-lg bg-on-primary-container px-6 py-2 font-body text-label-bold text-label-bold text-primary-container transition-all hover:brightness-110 active:scale-95"
            >
              Contact Support
            </button>
          </div>
          <div className="pointer-events-none absolute -bottom-10 -right-10 rotate-12 opacity-20 transition-transform duration-500 group-hover:scale-110">
            <span className="material-symbols-outlined text-[240px]">
              support_agent
            </span>
          </div>
        </div>
      </div>

      <footer className="mt-gutter flex flex-col items-center justify-between gap-4 border-t border-outline-variant pt-8 text-on-surface-variant opacity-60 md:flex-row">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" />
            All systems operational
          </span>
          <span className="hidden md:inline">•</span>
          <span>v4.2.1-stable</span>
        </div>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="transition-colors hover:text-primary"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            className="transition-colors hover:text-primary"
          >
            Terms of Service
          </button>
          <button
            type="button"
            className="transition-colors hover:text-primary"
          >
            Data Export
          </button>
        </div>
      </footer>
    </DashboardShell>
  );
}
