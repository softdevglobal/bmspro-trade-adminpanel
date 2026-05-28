"use client";

import {
  CUSTOMER_FIXED_NAV_BAR_CLASS,
  CUSTOMER_FIXED_NAV_INNER_CLASS,
  CustomerNavSpacer,
} from "@/components/customer-booking-shell";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  accountPath,
  booknowPath,
  isBooknowAccountPath,
  parseAccountTabFromPathname,
  parseBooknowSlug,
} from "@/lib/customer/booking-routes";
import {
  buildCustomerNotifications,
  countUnread,
  readLastSeenAt,
} from "@/lib/customer/notifications";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutConfirmModal } from "@/components/sign-out-confirm-modal";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

export type CustomerAccountTab =
  | "profile"
  | "requests"
  | "bookings"
  | "notifications";

const ICON_BTN =
  "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary active:scale-95 sm:h-11 sm:w-11";

/** Mobile stays compact; desktop gets more vertical room */
const NAV_ROW_H = "h-9 sm:h-12";

const NAV_PILL_OUTER =
  "w-full rounded-full border border-stone-200/90 bg-white/95 p-0.5 shadow-[0_8px_28px_-14px_rgba(0,74,198,0.15)] backdrop-blur-sm sm:p-1.5";

const NAV_PILL_INNER = `flex w-full min-w-0 items-center rounded-full bg-stone-100/80 p-0.5 sm:gap-1.5 sm:p-1.5 ${NAV_ROW_H}`;

const PRIMARY_NAV_BTN =
  "relative z-10 flex h-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-primary via-primary to-primary-container px-4 font-body font-bold text-on-primary shadow-md shadow-primary/25 ring-2 ring-primary/20 transition-all active:scale-[0.98] sm:min-w-[11.5rem] sm:gap-2.5 sm:px-10 sm:shadow-lg sm:shadow-primary/30 md:min-w-[13rem] md:px-12";

/** Icon-only guest CTAs — labels live in aria-label / title only */
const GUEST_ICON_BTN =
  "relative z-10 flex h-full w-[2.85rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl transition-all active:scale-95 sm:w-[3.35rem] sm:rounded-[22px]";

function GuestIconButton({
  icon,
  filled,
  ariaLabel,
  onClick,
  variant,
}: {
  icon: string;
  filled?: boolean;
  ariaLabel: string;
  onClick: () => void;
  variant: "join" | "signin";
}) {
  const isJoin = variant === "join";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`${GUEST_ICON_BTN} ${
        isJoin
          ? "bg-gradient-to-br from-primary via-primary to-primary-container text-on-primary shadow-[0_8px_20px_-6px_rgba(0,74,198,0.55)] ring-2 ring-primary/25 hover:brightness-105"
          : "border-2 border-stone-200/90 bg-white text-primary shadow-sm ring-1 ring-white hover:border-primary/35 hover:bg-primary/5 hover:shadow-md"
      }`}
    >
      {isJoin ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(255,255,255,0.28),transparent_55%)]"
        />
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[3px] rounded-[14px] border border-dashed border-primary/15 sm:inset-1 sm:rounded-[18px]"
        />
      )}
      <span
        className={`material-symbols-outlined relative z-10 text-[22px] sm:text-[26px] ${
          filled ? "material-symbols-filled" : ""
        }`}
      >
        {icon}
      </span>
      {isJoin ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-stone-900 shadow-sm ring-2 ring-white"
        >
          +
        </span>
      ) : null}
    </button>
  );
}

function CustomerAccountNavInner({ className }: { className?: string }) {
  const pathname = usePathname();
  const { status, getIdToken } = useCustomerAuth();
  const [unread, setUnread] = useState(0);

  const slug = parseBooknowSlug(pathname);
  const onAccount = isBooknowAccountPath(pathname);
  const onBookingPage = Boolean(slug) && !onAccount;
  const activeTab = onAccount ? parseAccountTabFromPathname(pathname) : null;

  const smallTabs = useMemo(() => {
    if (!slug) return [];
    return [
      {
        id: "requests",
        label: "Requests",
        icon: "forum",
        href: accountPath(slug, "requests"),
        isActive: onAccount && activeTab === "requests",
      },
      {
        id: "bookings",
        label: "History",
        icon: "receipt_long",
        href: accountPath(slug, "bookings"),
        isActive: onAccount && activeTab === "bookings",
      },
      {
        id: "profile",
        label: "Profile",
        icon: "person",
        href: accountPath(slug, "profile"),
        isActive: onAccount && activeTab === "profile",
      },
    ];
  }, [slug, onAccount, activeTab]);

  const loadUnread = useCallback(async () => {
    if (status !== "authenticated") {
      setUnread(0);
      return;
    }
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      const response = await fetch("/api/customer/bookings", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        bookings?: Parameters<typeof buildCustomerNotifications>[0];
      };
      if (!response.ok || !payload.ok) return;
      const notes = buildCustomerNotifications(payload.bookings ?? []);
      setUnread(countUnread(notes, readLastSeenAt()));
    } catch {
      setUnread(0);
    }
  }, [status, getIdToken]);

  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);

  if (status !== "authenticated" || !slug) return null;

  const bookActive = onBookingPage;
  const notificationsActive = onAccount && activeTab === "notifications";

  return (
    <nav
      aria-label="Customer"
      className={`w-full min-w-0 ${className ?? ""}`}
    >
      <div className={NAV_PILL_OUTER}>
        <div className={`${NAV_PILL_INNER} gap-0.5`}>
          {/* Book — wider + taller on desktop only */}
          <Link
            href={booknowPath(slug)}
            title="Book a visit"
            className={`relative z-10 flex h-full shrink-0 items-center justify-center gap-1.5 rounded-full px-4 font-body font-bold text-on-primary transition-all active:scale-[0.98] sm:min-w-[11.5rem] sm:gap-2.5 sm:px-10 md:min-w-[13rem] md:px-12 ${
              bookActive
                ? "bg-gradient-to-br from-primary via-primary to-primary-container shadow-md shadow-primary/25 ring-2 ring-primary/20 sm:shadow-lg sm:shadow-primary/30"
                : "bg-primary shadow-sm hover:bg-primary/95"
            }`}
          >
            <span className="material-symbols-outlined shrink-0 text-[18px] sm:text-[26px] md:text-[28px]">
              calendar_add_on
            </span>
            <span className="whitespace-nowrap text-[13px] sm:text-[17px] md:text-[18px]">
              Book
            </span>
          </Link>

          {/* Tabs — share remaining width */}
          <div className="relative flex min-w-0 flex-1 items-center justify-evenly">
            {smallTabs.map((tab) => (
              <Link
                key={tab.id}
                href={tab.href}
                title={tab.label}
                aria-label={tab.label}
                className={`relative z-10 flex h-full min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 font-body font-semibold transition-colors sm:gap-1.5 sm:px-4 ${
                  tab.isActive
                    ? "text-primary"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {tab.isActive ? (
                  <motion.span
                    layoutId="customer-nav-pill"
                    className="absolute inset-0 rounded-full bg-white shadow-sm ring-1 ring-stone-200/80"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                ) : null}
                <span
                  className={`material-symbols-outlined relative z-10 shrink-0 text-[17px] sm:text-[20px] ${
                    tab.isActive ? "text-primary" : "text-stone-500"
                  }`}
                >
                  {tab.icon}
                </span>
                <span className="relative z-10 hidden truncate text-[11px] sm:inline sm:text-[13px]">
                  {tab.label}
                </span>
              </Link>
            ))}
          </div>

          {/* Utilities inside the pill */}
          <div className="flex shrink-0 items-center gap-1 pr-0.5 sm:gap-1.5 sm:pr-1">
            <Link
              href={accountPath(slug, "notifications")}
              aria-label="Notifications"
              title="Notifications"
              className={`${ICON_BTN} ${
                notificationsActive
                  ? "border-primary/40 bg-primary/10 text-primary ring-2 ring-primary/15"
                  : ""
              }`}
            >
              <span className="material-symbols-outlined text-[18px] sm:text-[20px]">
                notifications
              </span>
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-0.5 font-body text-[8px] font-bold text-white ring-2 ring-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>
            <CustomerSignOutButton className={ICON_BTN} />
          </div>
        </div>
      </div>
    </nav>
  );
}

export function CustomerAccountNav(props: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <CustomerAccountNavInner {...props} />
    </Suspense>
  );
}

export function CustomerSignOutButton({
  className,
}: {
  className?: string;
}) {
  const { status, logout } = useCustomerAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (status !== "authenticated") return null;

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? ICON_BTN}
        title="Sign out"
        aria-label="Sign out"
      >
        <span className="material-symbols-outlined text-[20px] text-rose-600">
          logout
        </span>
      </button>
      <SignOutConfirmModal
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirmSignOut()}
        isLoading={signingOut}
        description="You will need to sign in again to book visits and view your requests."
      />
    </>
  );
}

/** Full-width guest nav: business left, creative auth CTAs right */
export function CustomerGuestNav({
  businessName,
}: {
  businessName: string;
}) {
  const { openAuth } = useCustomerAuth();

  return (
    <nav aria-label="Account access" className="w-full min-w-0">
      <div className={NAV_PILL_OUTER}>
        <div className={`${NAV_PILL_INNER} justify-between gap-2 sm:gap-3`}>
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-0.5 sm:gap-2.5 sm:pl-1">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/15 sm:h-9 sm:w-9">
              <span className="material-symbols-outlined text-[18px] sm:text-[20px]">
                storefront
              </span>
            </span>
            <div className="min-w-0 text-left">
              <p className="truncate font-body text-[10px] font-bold uppercase tracking-wider text-primary/75 sm:text-[11px]">
                Booking with
              </p>
              <p className="truncate font-display text-[14px] font-semibold text-on-surface sm:text-[16px]">
                {businessName}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <GuestIconButton
              variant="join"
              icon="rocket_launch"
              filled
              ariaLabel={`Get started — create account for ${businessName}`}
              onClick={() => openAuth({ mode: "signup", businessName })}
            />
            <GuestIconButton
              variant="signin"
              icon="login"
              ariaLabel={`Welcome back — sign in to ${businessName}`}
              onClick={() => openAuth({ mode: "signin", businessName })}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

export function CustomerTopNav({ className }: { className?: string }) {
  const { status } = useCustomerAuth();
  if (status !== "authenticated") return null;

  return (
    <>
      <div className={`${CUSTOMER_FIXED_NAV_BAR_CLASS} ${className ?? ""}`}>
        <div className={CUSTOMER_FIXED_NAV_INNER_CLASS}>
          <CustomerAccountNav />
        </div>
      </div>
      <CustomerNavSpacer />
    </>
  );
}
