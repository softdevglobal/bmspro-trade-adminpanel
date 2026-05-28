"use client";

import { SignOutConfirmModal } from "@/components/sign-out-confirm-modal";
import { useAuth } from "@/lib/auth/auth-context";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Today is /dashboard only — not parent of other /dashboard/* routes. */
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "#") return false;
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today", icon: "calendar_today" },
  { href: "#", label: "Calendar", icon: "calendar_month" },
  { href: "/dashboard/bookings", label: "Bookings", icon: "assignment" },
  {
    href: "/dashboard/inspection-visits",
    label: "Inspection visits",
    icon: "event_available",
  },
  { href: "#", label: "Messages", icon: "chat" },
  { href: "/dashboard/team", label: "Team", icon: "groups" },
  { href: "#", label: "Availability", icon: "schedule" },
  { href: "#", label: "Customers", icon: "group" },
  { href: "/dashboard/services", label: "Services", icon: "settings_suggest" },
  { href: "/dashboard/tenants", label: "Tenants", icon: "domain", superAdmin: true },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
] as const;

type SidebarProps = {
  isExpanded: boolean;
  isMobileOpen: boolean;
  onToggleExpand: () => void;
  onCloseMobile: () => void;
};

export function Sidebar({
  isExpanded,
  isMobileOpen,
  onToggleExpand,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, role } = useAuth();

  const roleLabel =
    role === "super_admin"
      ? "Super Admin"
      : role === "business_owner"
        ? "Business Owner"
        : "User";
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const showLabels = isExpanded || isMobileOpen;

  useEffect(() => {
    onCloseMobile();
  }, [pathname, onCloseMobile]);

  async function confirmSignOut() {
    setIsSigningOut(true);
    try {
      await logout();
    } finally {
      setIsSigningOut(false);
      setSignOutOpen(false);
    }
  }

  function navItemClass(isActive: boolean) {
    if (showLabels) {
      return isActive
        ? "flex h-11 w-full items-center gap-3 rounded-xl bg-on-primary-fixed-variant px-3 text-primary-fixed-dim shadow-md transition-all duration-200"
        : "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-outline-variant transition-all duration-200 hover:bg-on-secondary-fixed-variant hover:text-surface-bright";
    }
    return isActive
      ? "flex h-12 w-12 items-center justify-center rounded-xl bg-on-primary-fixed-variant text-primary-fixed-dim shadow-md transition-all duration-200"
      : "flex h-12 w-12 items-center justify-center rounded-xl text-outline-variant transition-all duration-200 hover:bg-on-secondary-fixed-variant hover:text-surface-bright";
  }

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onCloseMobile}
        className={`fixed inset-0 z-40 bg-on-background/60 backdrop-blur-sm transition-opacity lg:hidden ${
          isMobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full flex-col bg-on-background py-base text-inverse-on-surface transition-[width,transform] duration-300 ease-in-out ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 ${
          showLabels ? "w-[240px]" : "w-sidebar-width"
        }`}
      >
        {/* Header: logo + expand toggle (desktop) */}
        <div
          className={`mb-6 mt-2 flex shrink-0 items-center px-3 ${
            showLabels ? "justify-between gap-2" : "justify-center"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
              <span className="material-symbols-outlined material-symbols-filled text-[24px]">
                architecture
              </span>
            </div>
            {showLabels && (
              <span className="truncate font-display text-[15px] font-bold text-inverse-primary">
                BMS Pro Trade
              </span>
            )}
          </div>

          {showLabels && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-outline-variant hover:bg-on-secondary-fixed-variant lg:hidden"
              aria-label="Close menu"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        <nav
          className={`flex flex-1 flex-col gap-1 overflow-y-auto ${
            showLabels ? "px-3" : "items-center px-2"
          }`}
        >
          {NAV_ITEMS.filter(
            (item) => !("superAdmin" in item && item.superAdmin) || role === "super_admin"
          ).map((item) => {
            const isActive = isNavItemActive(pathname, item.href);

            const inner = (
              <>
                <span
                  className={`material-symbols-outlined shrink-0 text-[22px] ${
                    isActive ? "material-symbols-filled" : ""
                  }`}
                >
                  {item.icon}
                </span>
                {showLabels && (
                  <span className="truncate font-body text-[14px] font-medium">
                    {item.label}
                  </span>
                )}
                {!showLabels && <span className="sr-only">{item.label}</span>}
              </>
            );

            const className = navItemClass(isActive);

            if (item.href === "#") {
              return (
                <span
                  key={item.label}
                  title={`${item.label} (coming soon)`}
                  className={`${className} cursor-not-allowed opacity-40`}
                >
                  {inner}
                </span>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                title={item.label}
                className={className}
                onClick={onCloseMobile}
              >
                {inner}
              </Link>
            );
          })}
        </nav>

        {/* Expand / collapse — desktop only */}
        <div className={`mb-2 px-3 ${showLabels ? "" : "flex justify-center"}`}>
          <button
            type="button"
            onClick={onToggleExpand}
            className={`hidden items-center gap-2 rounded-lg text-outline-variant transition-colors hover:bg-on-secondary-fixed-variant hover:text-surface-bright lg:flex ${
              showLabels
                ? "h-10 w-full justify-center px-3"
                : "h-10 w-10 justify-center"
            }`}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            title={isExpanded ? "Collapse menu" : "Show menu names"}
          >
            <span className="material-symbols-outlined text-[22px]">
              {isExpanded ? "chevron_left" : "chevron_right"}
            </span>
            {showLabels && (
              <span className="font-body text-[13px] font-medium">
                Collapse
              </span>
            )}
          </button>
        </div>

        <div
          className={`flex shrink-0 flex-col gap-2 border-t border-on-secondary-fixed-variant/30 pt-4 ${
            showLabels ? "px-3" : "items-center px-2"
          }`}
        >
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            title="Sign out"
            className={
              showLabels
                ? "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-outline-variant transition-all hover:bg-on-secondary-fixed-variant hover:text-surface-bright"
                : "flex h-12 w-12 items-center justify-center rounded-xl text-outline-variant transition-all hover:bg-on-secondary-fixed-variant hover:text-surface-bright"
            }
          >
            <span className="material-symbols-outlined shrink-0 text-[22px]">
              logout
            </span>
            {showLabels && (
              <span className="font-body text-[14px] font-medium">Sign out</span>
            )}
            {!showLabels && <span className="sr-only">Sign out</span>}
          </button>

          <div
            className={`flex items-center gap-3 ${showLabels ? "px-1 pb-2" : "pb-4"}`}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-primary-container font-body text-[14px] font-bold text-on-primary"
              title={user?.email ?? "Admin"}
            >
              {(user?.email?.[0] ?? "A").toUpperCase()}
            </div>
            {showLabels && (
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-[13px] font-semibold text-inverse-on-surface">
                  {roleLabel}
                </p>
                <p className="truncate font-body text-[11px] text-outline-variant">
                  {user?.email ?? ""}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <SignOutConfirmModal
        open={signOutOpen}
        onCancel={() => setSignOutOpen(false)}
        onConfirm={() => void confirmSignOut()}
        isLoading={isSigningOut}
      />
    </>
  );
}
