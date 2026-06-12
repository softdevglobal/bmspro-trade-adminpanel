"use client";

import { BookingLinkCard } from "@/components/booking-link-card";
import { DashboardShell } from "@/components/dashboard-shell";
import { SuperAdminDashboardOverview } from "@/components/super-admin-dashboard-overview";
import { useAuth } from "@/lib/auth/auth-context";
import { useBookings } from "@/lib/bookings/use-bookings";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import {
  computeDashboardOverview,
  type DashboardKpi,
} from "@/lib/dashboard/stats";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import { useBusinessNotifications } from "@/lib/notifications/business-notifications-context";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo } from "react";

const QUICK_ACTIONS = [
  {
    label: "Requests",
    desc: "Review & schedule",
    icon: "fact_check",
    href: "/dashboard/requests",
    tone: "from-emerald-500/15 to-emerald-600/5 text-emerald-700",
  },
  {
    label: "Calendar",
    desc: "Week at a glance",
    icon: "calendar_month",
    href: "/dashboard/calendar",
    tone: "from-primary/15 to-sky-500/5 text-primary",
  },
  {
    label: "Jobs",
    desc: "Jobs & assignments",
    icon: "assignment",
    href: "/dashboard/jobs",
    tone: "from-violet-500/15 to-violet-600/5 text-violet-700",
  },
  {
    label: "Quotations",
    desc: "Quotes & pricing",
    icon: "request_quote",
    href: "/dashboard/quotations",
    tone: "from-amber-500/15 to-orange-500/5 text-amber-800",
  },
  {
    label: "Team",
    desc: "Staff & partners",
    icon: "groups",
    href: "/dashboard/team",
    tone: "from-teal-500/15 to-teal-600/5 text-teal-700",
  },
  {
    label: "Settings",
    desc: "Business profile",
    icon: "tune",
    href: "/dashboard/settings",
    tone: "from-slate-500/10 to-slate-600/5 text-slate-700",
  },
] as const;

const KPI_STYLES: Record<
  DashboardKpi["accent"],
  { shell: string; icon: string; glow: string }
> = {
  blue: {
    shell:
      "border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-blue-50/80",
    icon: "bg-sky-500 text-white shadow-[0_8px_20px_-8px_rgba(14,165,233,0.65)]",
    glow: "bg-sky-400/20",
  },
  amber: {
    shell:
      "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/70",
    icon: "bg-amber-500 text-white shadow-[0_8px_20px_-8px_rgba(245,158,11,0.65)]",
    glow: "bg-amber-400/20",
  },
  violet: {
    shell:
      "border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/60",
    icon: "bg-violet-500 text-white shadow-[0_8px_20px_-8px_rgba(139,92,246,0.65)]",
    glow: "bg-violet-400/20",
  },
  emerald: {
    shell:
      "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50/70",
    icon: "bg-emerald-500 text-white shadow-[0_8px_20px_-8px_rgba(16,185,129,0.65)]",
    glow: "bg-emerald-400/20",
  },
};

const ACTIVITY_ICONS: Record<string, string> = {
  request_created: "inbox",
  request_scheduled: "event_available",
  request_proposed: "edit_calendar",
  request_assigned: "person_check",
  request_cancelled: "event_busy",
  request_completed: "check_circle",
  quotation_accepted: "check_circle",
  quotation_rejected: "cancel",
  visit_on_the_way: "directions_car",
  booking_on_the_way: "engineering",
};

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatActivityTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTodayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DashboardOverview() {
  const { role } = useAuth();
  if (role === "super_admin") {
    return <SuperAdminDashboardOverview />;
  }

  return <BusinessDashboardOverview />;
}

function BusinessDashboardOverview() {
  const profile = useBusinessProfile();
  const { bookings, loading: bookingsLoading } = useBookings();
  const { requests, loading: requestsLoading } = useInspectionRequests();
  const { notifications, loading: notificationsLoading, unread } =
    useBusinessNotifications();
  const { staff, loading: staffLoading } = useBusinessStaffSummary();

  const loading =
    bookingsLoading || requestsLoading || notificationsLoading || staffLoading;

  const overview = useMemo(
    () =>
      computeDashboardOverview({
        bookings,
        requests,
        notifications,
        staffCount: staff.length,
      }),
    [bookings, requests, notifications, staff.length],
  );

  const businessName = profile?.businessName?.trim() || "your business";
  const greeting = greetingForHour(new Date().getHours());

  return (
    <DashboardShell title="Dashboard" hidePageHeader>
      <div className="space-y-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-[24px] border border-primary/15 bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-5 py-6 text-on-primary shadow-[0_18px_50px_-24px_rgba(0,74,198,0.75)] sm:px-7 sm:py-7"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-1/3 h-28 w-56 rounded-full bg-sky-300/20 blur-3xl"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="font-body text-[12px] font-bold uppercase tracking-[0.18em] text-on-primary/70">
                {formatTodayLabel()}
              </p>
              <h1 className="mt-2 font-display text-[28px] font-bold leading-tight sm:text-[34px]">
                {greeting}, {businessName}
              </h1>
              <p className="mt-2 max-w-2xl font-body text-[14px] leading-relaxed text-on-primary/80 sm:text-[15px]">
                {loading
                  ? "Pulling in your live schedule…"
                  : (overview.focusMessage ??
                    "Your command centre for jobs, visits, and customer updates.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/calendar"
                className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary backdrop-blur-sm transition hover:bg-white/18"
              >
                <span className="material-symbols-outlined text-[18px]">
                  calendar_month
                </span>
                Open calendar
              </Link>
              <Link
                href="/dashboard/requests"
                className="inline-flex items-center gap-2 rounded-full bg-on-primary px-4 py-2.5 font-body text-[13px] font-bold text-primary shadow-lg shadow-black/15 transition hover:brightness-95"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add_circle
                </span>
                New request
              </Link>
            </div>
          </div>
        </motion.section>

        <BookingLinkCard variant="ephemeral" />

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {overview.pipeline.map((stage, index) => (
            <motion.div
              key={stage.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * index }}
              className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest/90 px-4 py-3 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  {stage.icon}
                </span>
                <span className="font-body text-[12px] font-semibold uppercase tracking-wide text-on-surface-variant">
                  {stage.label}
                </span>
              </div>
              <p className="mt-2 font-display text-[24px] font-bold text-on-surface">
                {loading ? "—" : stage.value}
              </p>
            </motion.div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {overview.kpis.map((card, index) => {
            const style = KPI_STYLES[card.accent];
            return (
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * index }}
                className={`relative overflow-hidden rounded-[22px] border p-5 ${style.shell}`}
              >
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl ${style.glow}`}
                />
                <div className="relative flex items-start justify-between gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl ${style.icon}`}
                  >
                    <span className="material-symbols-outlined text-[22px]">
                      {card.icon}
                    </span>
                  </span>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-right font-body text-[11px] font-semibold text-on-surface-variant">
                    {loading ? "…" : card.trend}
                  </span>
                </div>
                <p className="relative mt-5 font-display text-[34px] font-bold leading-none text-on-surface">
                  {loading ? "—" : card.value}
                </p>
                <p className="relative mt-2 font-body text-[14px] font-medium text-on-surface-variant">
                  {card.label}
                </p>
              </motion.div>
            );
          })}
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="xl:col-span-7 rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[20px] font-bold text-on-surface">
                  Live feed
                </h2>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  Latest customer and booking updates
                </p>
              </div>
              {unread > 0 ? (
                <span className="rounded-full bg-primary px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wide text-on-primary">
                  {unread} new
                </span>
              ) : null}
            </div>

            {loading ? (
              <div className="mt-6 space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-2xl bg-surface-container-low"
                  />
                ))}
              </div>
            ) : overview.activity.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-5 py-10 text-center">
                <span className="material-symbols-outlined text-[32px] text-outline">
                  notifications_paused
                </span>
                <p className="mt-3 font-body text-[14px] text-on-surface-variant">
                  Quiet for now. New requests and booking events will stream in
                  here.
                </p>
              </div>
            ) : (
              <ul className="mt-6 space-y-0">
                {overview.activity.map((item, index) => (
                  <li key={item.id} className="relative flex gap-4 pb-5">
                    {index < overview.activity.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute left-[18px] top-10 bottom-0 w-px bg-outline-variant/80"
                      />
                    ) : null}
                    <span
                      className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        item.read
                          ? "bg-surface-container-high text-outline"
                          : "bg-primary text-on-primary shadow-md shadow-primary/25"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {ACTIVITY_ICONS[item.type] ?? "bolt"}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="font-body text-[14px] font-medium text-on-surface">
                        {item.text}
                      </p>
                      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                        {formatActivityTime(item.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>

          <div className="space-y-6 xl:col-span-5">
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[20px] font-bold text-on-surface">
                    Coming up
                  </h2>
                  <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                    Next jobs on your schedule
                  </p>
                </div>
                <Link
                  href="/dashboard/calendar"
                  className="font-body text-[12px] font-bold text-primary hover:underline"
                >
                  View all
                </Link>
              </div>

              {loading ? (
                <div className="mt-5 space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-14 animate-pulse rounded-2xl bg-surface-container-low"
                    />
                  ))}
                </div>
              ) : overview.upcoming.length === 0 ? (
                <div className="mt-5 rounded-2xl bg-surface-container-low px-4 py-8 text-center">
                  <span className="material-symbols-outlined text-[28px] text-outline">
                    event_available
                  </span>
                  <p className="mt-2 font-body text-[13px] text-on-surface-variant">
                    No upcoming jobs yet. Scheduled jobs and visits will
                    show here.
                  </p>
                </div>
              ) : (
                <ul className="mt-5 space-y-3">
                  {overview.upcoming.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="group flex items-center gap-3 rounded-2xl border border-outline-variant/70 bg-gradient-to-r from-surface-container-low to-surface-container-lowest px-4 py-3 transition hover:border-primary/30 hover:shadow-sm"
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            item.kind === "booking"
                              ? "bg-primary/10 text-primary"
                              : "bg-emerald-500/10 text-emerald-700"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            {item.kind === "booking" ? "assignment" : "fact_check"}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body text-[14px] font-semibold text-on-surface">
                            {item.title}
                          </p>
                          <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                            {item.dateLabel} · {item.statusLabel}
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-[18px] text-outline transition group-hover:text-primary">
                          chevron_right
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"
            >
              <h2 className="font-display text-[20px] font-bold text-on-surface">
                Quick launch
              </h2>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                Jump straight into the work
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {QUICK_ACTIONS.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className={`group rounded-2xl border border-outline-variant/60 bg-gradient-to-br px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-md ${action.tone}`}
                  >
                    <span className="material-symbols-outlined text-[22px]">
                      {action.icon}
                    </span>
                    <p className="mt-3 font-body text-[14px] font-bold text-on-surface">
                      {action.label}
                    </p>
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      {action.desc}
                    </p>
                  </Link>
                ))}
              </div>
            </motion.section>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
