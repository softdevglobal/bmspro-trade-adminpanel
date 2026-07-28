"use client";

import { BookingLinkCard } from "@/components/booking-link-card";
import { SuperAdminDashboardOverview } from "@/components/super-admin-dashboard-overview";
import { useAuth } from "@/lib/auth/auth-context";
import { useBookings } from "@/lib/bookings/use-bookings";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import {
  buildLiveFeedActivity,
  computeDashboardOverview,
  type DashboardKpi,
} from "@/lib/dashboard/stats";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import { useBusinessNotifications } from "@/lib/notifications/business-notifications-context";
import {
  formatInPlatformTimeZone,
  resolvePlatformTimeZone,
} from "@/lib/platform/timezone";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useStripeCheckoutReturn } from "@/lib/stripe/use-stripe-checkout-return";
import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";

type LiveFeedFilter = "all" | "customer" | "staff";

const LIVE_FEED_FILTERS: { id: LiveFeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "customer", label: "Customer" },
  { id: "staff", label: "Staff" },
];

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

const KPI_LINKS: Record<string, string> = {
  today: "/dashboard/calendar",
  unassigned: "/dashboard/jobs",
  awaiting_invoice: "/dashboard/invoices",
  messages: "/dashboard#live-feed",
  team: "/dashboard/team",
};

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
  quotation_sent: "request_quote",
  quotation_accepted: "check_circle",
  quotation_rejected: "cancel",
  visit_on_the_way: "directions_car",
  booking_on_the_way: "engineering",
  job_completed: "handyman",
  invoice_sent: "receipt_long",
  leave_requested: "event_busy",
  leave_assignment_conflict: "warning",
  staff_off_day: "event_busy",
  schedule_reminder: "notifications_active",
  system_message: "campaign",
};

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatActivityTime(
  timestamp: number,
  timeZone?: string | null,
): string {
  if (!timestamp) return "";
  return formatInPlatformTimeZone(timestamp, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }, timeZone);
}

function formatTodayLabel(timeZone?: string | null): string {
  return formatInPlatformTimeZone(new Date(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  }, timeZone);
}

function currentHourInTimeZone(timeZone?: string | null): number {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: resolvePlatformTimeZone(timeZone),
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "",
    10,
  );
  return Number.isFinite(hour) ? hour : new Date().getHours();
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
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [liveFeedFilter, setLiveFeedFilter] = useState<LiveFeedFilter>("all");
  const [staffNameFilter, setStaffNameFilter] = useState("");
  const { bookings, loading: bookingsLoading } = useBookings();
  const { requests, loading: requestsLoading } = useInspectionRequests();
  const { notifications, loading: notificationsLoading, unread } =
    useBusinessNotifications();
  const { staff, loading: staffLoading } = useBusinessStaffSummary();
  const timeZone = profile?.timezone;

  const loading =
    bookingsLoading || requestsLoading || notificationsLoading || staffLoading;

  const staffNames = useMemo(
    () =>
      staff
        .map((member) => member.fullName.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [staff],
  );

  const overview = useMemo(
    () =>
      computeDashboardOverview({
        bookings,
        requests,
        notifications,
        staffCount: staff.length,
        timeZone,
      }),
    [bookings, requests, notifications, staff.length, timeZone],
  );

  const liveFeedActivity = useMemo(
    () =>
      buildLiveFeedActivity(notifications, {
        staffNames,
        category: liveFeedFilter,
        staffName: liveFeedFilter === "staff" ? staffNameFilter || null : null,
        limit: 12,
      }),
    [notifications, staffNames, liveFeedFilter, staffNameFilter],
  );

  const liveFeedCounts = useMemo(() => {
    const all = buildLiveFeedActivity(notifications, {
      staffNames,
      limit: Number.POSITIVE_INFINITY,
    });
    return {
      all: all.length,
      customer: all.filter((item) => item.category === "customer").length,
      staff: all.filter((item) => item.category === "staff").length,
    };
  }, [notifications, staffNames]);

  const businessName = profile?.businessName?.trim() || "your business";
  const greeting = greetingForHour(currentHourInTimeZone(timeZone));

  useStripeCheckoutReturn({
    onSuccess: (result) => {
      setCheckoutNotice(
        result.type === "subscription"
          ? "Subscription payment confirmed. Your account is active."
          : "Payment confirmed.",
      );
    },
    onCanceled: () => {
      setCheckoutNotice("Checkout was canceled. No charges were made.");
    },
    onError: (message) => setCheckoutNotice(message),
  });

  return (
    <div className="space-y-6">
        {checkoutNotice ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 font-body text-[12px] font-semibold text-emerald-800">
            {checkoutNotice}
          </p>
        ) : null}
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
                {formatTodayLabel(timeZone)}
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

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {overview.kpis.map((card, index) => {
            const style = KPI_STYLES[card.accent];
            const href = KPI_LINKS[card.key] ?? "/dashboard";
            return (
              <Link
                key={card.key}
                href={href}
                className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * index }}
                  className={`relative overflow-hidden rounded-[22px] border p-5 transition-transform hover:-translate-y-0.5 hover:shadow-md ${style.shell}`}
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
              </Link>
            );
          })}
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <motion.section
            id="live-feed"
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
                  Latest customer and staff updates
                </p>
              </div>
              {unread > 0 ? (
                <span className="rounded-full bg-primary px-3 py-1 font-body text-[11px] font-bold uppercase tracking-wide text-on-primary">
                  {unread} new
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div
                className="flex flex-wrap gap-2"
                role="tablist"
                aria-label="Live feed filter"
              >
                {LIVE_FEED_FILTERS.map((tab) => {
                  const active = liveFeedFilter === tab.id;
                  const count = liveFeedCounts[tab.id];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setLiveFeedFilter(tab.id);
                        if (tab.id !== "staff") setStaffNameFilter("");
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-on-primary shadow-sm"
                          : "border-outline-variant/70 bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      {tab.label}
                      <span
                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                          active
                            ? "bg-on-primary/20 text-on-primary"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {liveFeedFilter === "staff" ? (
                <label className="flex min-w-0 flex-col gap-1 sm:w-56">
                  <span className="sr-only">Filter by staff name</span>
                  <select
                    value={staffNameFilter}
                    onChange={(event) => setStaffNameFilter(event.target.value)}
                    className="h-10 w-full rounded-xl border border-outline-variant/70 bg-surface-container-low px-3 font-body text-[13px] font-semibold text-on-surface outline-none transition-colors hover:bg-surface-container-high focus:border-primary focus:ring-2 focus:ring-primary/20"
                    aria-label="Filter by staff name"
                  >
                    <option value="">All staff</option>
                    {staffNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
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
            ) : liveFeedActivity.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-5 py-10 text-center">
                <span className="material-symbols-outlined text-[32px] text-outline">
                  notifications_paused
                </span>
                <p className="mt-3 font-body text-[14px] text-on-surface-variant">
                  {liveFeedFilter === "staff" && staffNameFilter
                    ? `No staff updates for ${staffNameFilter} yet.`
                    : liveFeedFilter === "staff"
                      ? "No staff updates yet. Leave requests and assignments will show here."
                      : liveFeedFilter === "customer"
                        ? "No customer updates yet. New requests and booking events will show here."
                        : "Quiet for now. Customer and staff updates will stream in here."}
                </p>
              </div>
            ) : (
              <ul className="mt-6 space-y-0">
                {liveFeedActivity.map((item, index) => (
                  <li key={item.id} className="relative flex gap-4 pb-5">
                    {index < liveFeedActivity.length - 1 ? (
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-body text-[14px] font-medium text-on-surface">
                          {item.text}
                        </p>
                        {item.category === "staff" ||
                        item.category === "customer" ? (
                          <span
                            className={`rounded-full px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide ${
                              item.category === "staff"
                                ? "bg-teal-100 text-teal-800"
                                : "bg-sky-100 text-sky-800"
                            }`}
                          >
                            {item.category}
                          </span>
                        ) : null}
                      </div>
                      {item.body ? (
                        <p className="mt-1 line-clamp-2 font-body text-[12px] text-on-surface-variant">
                          {item.body}
                        </p>
                      ) : null}
                      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                        {[
                          item.staffName || item.customerName,
                          formatActivityTime(item.createdAt, timeZone),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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
  );
}
