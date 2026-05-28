"use client";

import { Sidebar } from "@/components/sidebar";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useState } from "react";

const PAGE_ICONS: Record<string, string> = {
  Dashboard: "dashboard",
  Bookings: "assignment",
  "Inspection visits": "event_available",
  Team: "groups",
  Services: "settings_suggest",
  Settings: "settings",
  Tenants: "domain",
};

function iconForPageTitle(title: string, override?: string) {
  if (override) return override;
  return PAGE_ICONS[title] ?? "article";
}

function DashboardPageHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon: string;
}) {
  return (
    <div className="relative mb-4 min-w-0 overflow-hidden rounded-2xl bg-on-background shadow-[0_10px_28px_-12px_rgba(25,27,35,0.45)] sm:mb-6 sm:rounded-[20px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/25 via-primary/5 to-transparent"
      />
      <div className="relative flex min-w-0 items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary shadow-[0_4px_14px_rgba(0,74,198,0.35)] sm:h-12 sm:w-12">
          <span className="material-symbols-outlined material-symbols-filled text-[24px] sm:text-[26px]">
            {icon}
          </span>
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="font-display text-[20px] font-bold leading-tight text-inverse-on-surface sm:text-[26px]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 font-body text-[13px] leading-snug text-inverse-on-surface/75 sm:text-[15px]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Material Symbols name; inferred from page title when omitted. */
  icon?: string;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("dashboard-sidebar-expanded");
    if (stored === "false") {
      setIsExpanded(false);
    } else if (stored === "true") {
      setIsExpanded(true);
    }
  }, []);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setIsMobileOpen(false);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileOpen]);

  const closeMobile = useCallback(() => setIsMobileOpen(false), []);
  const toggleExpand = useCallback(() => {
    setIsExpanded((current) => {
      const next = !current;
      sessionStorage.setItem("dashboard-sidebar-expanded", String(next));
      return next;
    });
  }, []);

  const email = user?.email ?? "Admin";

  const mainOffsetClass = isExpanded
    ? "lg:ml-[240px]"
    : "lg:ml-sidebar-width";

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-on-background">
      <Sidebar
        isExpanded={isExpanded}
        isMobileOpen={isMobileOpen}
        onToggleExpand={toggleExpand}
        onCloseMobile={closeMobile}
      />

      <div
        className={`flex min-h-dvh min-w-0 flex-col overflow-x-hidden transition-[margin] duration-300 ease-in-out ml-0 ${mainOffsetClass}`}
      >
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-outline-variant bg-surface/80 px-3 backdrop-blur-md sm:h-16 sm:px-gutter">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low lg:hidden"
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>

            <h1 className="truncate font-display text-headline-sm text-headline-sm font-bold text-primary">
              BMS Pro Trade
            </h1>

            <div className="hidden items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-4 py-1.5 md:flex">
              <span className="material-symbols-outlined text-[20px] text-outline">
                search
              </span>
              <input
                type="search"
                placeholder="Search bookings..."
                className="w-48 border-none bg-transparent font-body text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-0 lg:w-64"
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button
              type="button"
              className="hidden rounded-lg bg-primary px-5 py-2 font-body text-label-bold text-label-bold text-on-primary transition-all hover:bg-primary/90 sm:inline-flex"
            >
              Add Booking
            </button>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container font-body text-[14px] font-bold text-on-primary"
              title={email}
            >
              {email[0]?.toUpperCase() ?? "A"}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-full flex-1 overflow-x-hidden px-3 py-4 sm:max-w-container-max sm:p-gutter">
          <DashboardPageHeader
            title={title}
            subtitle={subtitle}
            icon={iconForPageTitle(title, icon)}
          />
          {children}
        </main>
      </div>
    </div>
  );
}
