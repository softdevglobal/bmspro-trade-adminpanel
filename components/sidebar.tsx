"use client";

import { SignOutConfirmModal } from "@/components/sign-out-confirm-modal";
import { useAuth, type AuthRole } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { countPendingInspectionRequests } from "@/lib/inspection/request-counts";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/** Today is /dashboard only — not parent of other /dashboard/* routes. */
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "#") return false;
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavItem = {
  href: string;
  label: string;
  icon: string;
  superAdmin?: boolean;
  businessOwner?: boolean;
  /** When set, only these dashboard roles see the link. */
  roles?: Exclude<AuthRole, null>[];
  children?: Array<{
    href: string;
    label: string;
    icon: string;
  }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: "calendar_today" },
  {
    href: "/dashboard/calendar",
    label: "Calendar",
    icon: "calendar_month",
    businessOwner: true,
  },
  {
    href: "/dashboard/requests",
    label: "Requests",
    icon: "event_available",
    businessOwner: true,
  },
  {
    href: "/dashboard/quotations",
    label: "Quotations",
    icon: "request_quote",
    businessOwner: true,
  },
  {
    href: "/dashboard/jobs",
    label: "Jobs",
    icon: "assignment",
    businessOwner: true,
  },
  {
    href: "/dashboard/invoices",
    label: "Invoices",
    icon: "receipt_long",
    businessOwner: true,
  },
  { href: "/dashboard/services", label: "Services", icon: "settings_suggest" },
  {
    href: "/dashboard/team",
    label: "Team",
    icon: "groups",
    businessOwner: true,
    children: [
      {
        href: "/dashboard/team/management",
        label: "Team management",
        icon: "manage_accounts",
      },
      {
        href: "/dashboard/team/attendance",
        label: "Attendance",
        icon: "schedule",
      },
    ],
  },
  {
    href: "/dashboard/customers",
    label: "Customers",
    icon: "group",
    businessOwner: true,
  },
  {
    href: "/dashboard/items",
    label: "Item list",
    icon: "inventory_2",
    businessOwner: true,
  },
  {
    href: "/dashboard/tenants",
    label: "Tenants",
    icon: "domain",
    superAdmin: true,
  },
  {
    href: "/dashboard/packages",
    label: "Packages",
    icon: "inventory_2",
    superAdmin: true,
  },
  {
    href: "/dashboard/audit-log",
    label: "Audit logs",
    icon: "history",
    roles: ["super_admin", "business_owner", "staff"],
  },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

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
  const business = useBusinessProfile();
  const { requests } = useInspectionRequests();
  const pendingRequestCount = useMemo(
    () => countPendingInspectionRequests(requests),
    [requests],
  );
  const brandName = business?.businessName?.trim() || "BMS Pro Trade";
  const brandLogo =
    role === "business_owner" ? (business?.logoUrl ?? null) : null;

  const roleLabel =
    role === "super_admin"
      ? "Super Admin"
      : role === "business_owner"
        ? "Business Owner"
        : role === "staff"
          ? "Staff"
          : "User";
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>({});
  const [flyoutGroup, setFlyoutGroup] = useState<string | null>(null);

  const showLabels = isExpanded || isMobileOpen;

  useEffect(() => {
    if (pathname.startsWith("/dashboard/team")) {
      setOpenNavGroups((current) =>
        current.Team ? current : { ...current, Team: true },
      );
    }
  }, [pathname]);

  useEffect(() => {
    onCloseMobile();
    setFlyoutGroup(null);
  }, [pathname, onCloseMobile]);

  function isGroupOpen(label: string) {
    return openNavGroups[label] === true;
  }

  function toggleNavGroup(label: string) {
    setOpenNavGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  async function confirmSignOut() {
    setIsSigningOut(true);
    try {
      await logout();
    } finally {
      setIsSigningOut(false);
      setSignOutOpen(false);
    }
  }

  function navItemClass(isActive: boolean, isChild = false) {
    const padding = isChild ? "pl-9 pr-3" : "px-3";
    const base = `box-border flex h-10 min-h-10 max-h-10 w-full shrink-0 items-center justify-start gap-2.5 rounded-xl ${padding} text-left transition-[background-color,color,box-shadow] duration-300 ease-out`;
    if (showLabels) {
      return isActive
        ? `${base} bg-on-primary-fixed-variant text-primary-fixed-dim shadow-sm`
        : `${base} bg-transparent text-outline-variant hover:bg-on-secondary-fixed-variant/80 hover:text-surface-bright`;
    }
    return isActive
      ? "box-border flex h-11 min-h-11 max-h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-on-primary-fixed-variant text-primary-fixed-dim shadow-sm transition-[background-color,color,box-shadow] duration-300 ease-out"
      : "box-border flex h-11 min-h-11 max-h-11 w-11 shrink-0 items-center justify-center rounded-xl text-outline-variant transition-[background-color,color] duration-300 ease-out hover:bg-on-secondary-fixed-variant/80 hover:text-surface-bright";
  }

  function navIconClass(isActive: boolean, isChild = false) {
    return `material-symbols-outlined block shrink-0 ${
      isChild ? "text-[20px]" : "text-[22px]"
    } ${isActive ? "material-symbols-filled" : ""}`;
  }

  function navLabelClass(isChild = false) {
    return `min-w-0 flex-1 truncate font-body font-medium ${
      isChild ? "text-[13px]" : "text-[14px]"
    }`;
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
          className={`mb-4 mt-2 flex shrink-0 items-center px-3 ${
            showLabels ? "justify-between gap-2" : "justify-center"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-container text-on-primary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/bms_pro_blue.jpeg"
                alt={brandName}
                className="h-full w-full object-cover"
              />
            </div>
            {showLabels && (
              <span className="truncate font-display text-[15px] font-bold text-inverse-primary">
                {brandName}
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
          className={`flex flex-1 flex-col gap-0.5 overflow-y-auto [scrollbar-gutter:stable] ${
            showLabels ? "px-3" : "items-center px-2"
          }`}
        >
          {NAV_ITEMS.filter((item) => {
            if (item.roles) {
              return role != null && item.roles.includes(role);
            }
            if (item.superAdmin && role !== "super_admin") return false;
            if (item.businessOwner && role !== "business_owner") return false;
            return true;
          }).map((item) => {
            const childItems = item.children ?? [];
            const hasChildren = childItems.length > 0;
            const isActive = hasChildren
              ? false
              : isNavItemActive(pathname, item.href);
            const groupOpen = hasChildren ? isGroupOpen(item.label) : false;
            const showPendingBadge =
              item.href === "/dashboard/requests" && pendingRequestCount > 0;

            const inner = (
              <>
                <span className="relative shrink-0">
                  <span className={navIconClass(isActive)}>{item.icon}</span>
                  {showPendingBadge && !showLabels ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 font-body text-[9px] font-bold text-white ring-2 ring-on-background">
                      {pendingRequestCount > 9 ? "9+" : pendingRequestCount}
                    </span>
                  ) : null}
                </span>
                {showLabels && (
                  <span className={navLabelClass()}>
                    {item.href === "/dashboard" && role === "super_admin"
                      ? "Overview"
                      : item.label}
                  </span>
                )}
                {showPendingBadge && showLabels ? (
                  <span className="ml-auto inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 font-body text-[10px] font-bold tabular-nums text-white">
                    {pendingRequestCount > 99 ? "99+" : pendingRequestCount}
                  </span>
                ) : null}
                {hasChildren && showLabels ? (
                  <span
                    className={`material-symbols-outlined ml-auto shrink-0 text-[22px] leading-none transition-transform duration-300 ease-in-out ${
                      groupOpen ? "rotate-180" : ""
                    }`}
                  >
                    expand_more
                  </span>
                ) : null}
                {!showLabels && (
                  <span className="sr-only">
                    {item.href === "/dashboard" && role === "super_admin"
                      ? "Overview"
                      : item.label}
                    {showPendingBadge
                      ? `, ${pendingRequestCount} new request${pendingRequestCount === 1 ? "" : "s"}`
                      : ""}
                  </span>
                )}
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

            if (hasChildren) {
              const childLinks = childItems.map((child) => {
                const childActive = isNavItemActive(pathname, child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    title={child.label}
                    onClick={() => {
                      onCloseMobile();
                      setFlyoutGroup(null);
                    }}
                    className={navItemClass(childActive, true)}
                  >
                    <span className={navIconClass(childActive, true)}>
                      {child.icon}
                    </span>
                    <span className={navLabelClass(true)}>{child.label}</span>
                  </Link>
                );
              });

              return (
                <div key={item.label} className="relative flex flex-col gap-0.5">
                  <button
                    type="button"
                    title={item.label}
                    aria-expanded={groupOpen || flyoutGroup === item.label}
                    onClick={() => {
                      if (showLabels) {
                        toggleNavGroup(item.label);
                        return;
                      }
                      setFlyoutGroup((current) =>
                        current === item.label ? null : item.label,
                      );
                    }}
                    className={`${className} m-0 cursor-pointer border-0 font-inherit leading-none outline-none focus-visible:ring-2 focus-visible:ring-primary/30`}
                  >
                    {inner}
                  </button>

                  {showLabels ? (
                    <div
                      className={`ml-1 flex flex-col gap-0.5 overflow-hidden border-l border-on-secondary-fixed-variant/30 pl-1 transition-[max-height,opacity] duration-300 ease-in-out ${
                        groupOpen
                          ? "max-h-24 opacity-100"
                          : "pointer-events-none max-h-0 opacity-0"
                      }`}
                      aria-hidden={!groupOpen}
                    >
                      {childLinks}
                    </div>
                  ) : null}

                  {!showLabels && flyoutGroup === item.label ? (
                    <>
                      <button
                        type="button"
                        aria-label="Close team menu"
                        className="fixed inset-0 z-40 lg:hidden"
                        onClick={() => setFlyoutGroup(null)}
                      />
                      <div className="absolute left-full top-0 z-50 ml-2 min-w-[210px] rounded-xl border border-on-secondary-fixed-variant/30 bg-on-background py-2 shadow-xl">
                        <p className="px-4 pb-2 font-body text-[11px] font-bold uppercase tracking-wider text-outline-variant">
                          {item.label}
                        </p>
                        {childItems.map((child) => {
                          const childActive = isNavItemActive(
                            pathname,
                            child.href,
                          );
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              title={child.label}
                              onClick={() => {
                                onCloseMobile();
                                setFlyoutGroup(null);
                              }}
                              className={navItemClass(childActive, true)}
                            >
                              <span className={navIconClass(childActive, true)}>
                                {child.icon}
                              </span>
                              <span className={navLabelClass(true)}>
                                {child.label}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
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
          className={`flex shrink-0 flex-col gap-1 border-t border-on-secondary-fixed-variant/30 pt-3 ${
            showLabels ? "px-3" : "items-center px-2"
          }`}
        >
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            title="Sign out"
            className={
              showLabels
                ? "flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-outline-variant transition-[background-color,color] duration-300 ease-out hover:bg-on-secondary-fixed-variant/80 hover:text-surface-bright"
                : "flex h-11 w-11 items-center justify-center rounded-xl text-outline-variant transition-[background-color,color] duration-300 ease-out hover:bg-on-secondary-fixed-variant/80 hover:text-surface-bright"
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
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-primary-container font-body text-[14px] font-bold text-on-primary"
              title={brandLogo ? brandName : (user?.email ?? "Admin")}
            >
              {brandLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogo}
                  alt={brandName}
                  className="h-full w-full object-cover"
                />
              ) : (
                (user?.email?.[0] ?? "A").toUpperCase()
              )}
            </div>
            {showLabels && (
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-[13px] font-semibold text-inverse-on-surface">
                  {brandLogo ? brandName : roleLabel}
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
