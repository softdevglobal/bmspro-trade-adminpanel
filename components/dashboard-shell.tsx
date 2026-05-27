"use client";

import { Sidebar } from "@/components/sidebar";
import { auth } from "@/lib/firebase/client";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

export function DashboardShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
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
  const toggleExpand = useCallback(() => setIsExpanded((v) => !v), []);

  const email = user?.email ?? "Admin";

  const mainOffsetClass = isExpanded
    ? "lg:ml-[240px]"
    : "lg:ml-sidebar-width";

  return (
    <div className="min-h-dvh bg-background text-on-background">
      <Sidebar
        isExpanded={isExpanded}
        isMobileOpen={isMobileOpen}
        onToggleExpand={toggleExpand}
        onCloseMobile={closeMobile}
      />

      <div
        className={`flex min-h-dvh flex-col transition-[margin] duration-300 ease-in-out ml-0 ${mainOffsetClass}`}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-outline-variant bg-surface/80 px-4 backdrop-blur-md sm:px-gutter">
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

        <main className="mx-auto w-full max-w-container-max flex-1 p-4 sm:p-gutter">
          <div className="mb-6 sm:mb-8">
            <h2 className="font-display text-[26px] font-semibold text-on-surface sm:text-display-md">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
