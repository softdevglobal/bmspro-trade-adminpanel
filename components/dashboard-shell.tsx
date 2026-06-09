"use client";

import { BusinessNotificationBell } from "@/components/business-notification-bell";
import { Sidebar } from "@/components/sidebar";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useCallback, useEffect, useState } from "react";

const PAGE_ICONS: Record<string, string> = {
  Dashboard: "dashboard",
  Calendar: "calendar_month",
  Bookings: "assignment",
  "Inspection visits": "event_available",
  Team: "groups",
  Customers: "group",
  Services: "settings_suggest",
  Settings: "settings",
  Tenants: "domain",
  "Audit logs": "history",
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
  hidePageHeader,
  fullBleed,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Material Symbols name; inferred from page title when omitted. */
  icon?: string;
  hidePageHeader?: boolean;
  fullBleed?: boolean;
  children: React.ReactNode;
}) {
  const { user, role } = useAuth();
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
  const business = useBusinessProfile();
  const brandName = business?.businessName?.trim() || "BMS Pro Trade";
  const brandLogo =
    role === "business_owner" ? (business?.logoUrl ?? null) : null;

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
        className={`flex min-h-dvh min-w-0 flex-col transition-[margin] duration-300 ease-in-out ml-0 ${mainOffsetClass}`}
      >
        {/* Fixed on mobile (sticky breaks inside overflow-hidden parents); sticky on desktop */}
        <header className="fixed inset-x-0 top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-3 shadow-sm backdrop-blur-md sm:h-16 sm:px-gutter lg:relative lg:sticky lg:inset-x-auto lg:top-0 lg:z-30 lg:shadow-none">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low lg:hidden"
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>

            <div className="flex min-w-0 items-center gap-2">
              {brandLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogo}
                  alt={brandName}
                  className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-outline-variant"
                />
              ) : null}
              <h1 className="truncate font-display text-headline-sm text-headline-sm font-bold text-primary">
                {brandName}
              </h1>
            </div>

            {role === "business_owner" ? (
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
            ) : (
              <p className="hidden font-body text-[13px] font-medium text-on-surface-variant md:block">
                Platform administration
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {role === "business_owner" ? <BusinessNotificationBell /> : null}
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container font-body text-[14px] font-bold text-on-primary ring-1 ring-outline-variant"
              title={brandLogo ? brandName : email}
            >
              {brandLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogo}
                  alt={brandName}
                  className="h-full w-full object-cover"
                />
              ) : (
                (email[0] ?? "A").toUpperCase()
              )}
            </div>
          </div>
        </header>

        <main
          className={`mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-hidden ${
            fullBleed
              ? "px-0 pb-0 pt-[calc(3.5rem+0px)] sm:pt-[calc(4rem+0px)] lg:pt-0"
              : "px-3 pb-4 pt-[calc(3.5rem+1rem)] sm:max-w-container-max sm:pb-gutter sm:pt-[calc(4rem+1rem)] sm:px-gutter lg:px-3 lg:py-4 lg:pt-4"
          }`}
        >
          {!hidePageHeader ? (
            <DashboardPageHeader
              title={title}
              subtitle={subtitle}
              icon={iconForPageTitle(title, icon)}
            />
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
