"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { resolveDashboardPageMeta } from "@/lib/dashboard/page-meta";
import {
  DashboardPageMetaProvider,
  useDashboardPageMetaOverrideState,
} from "@/lib/dashboard/page-meta-context";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";

function DashboardLayoutShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const override = useDashboardPageMetaOverrideState();
  const meta = useMemo(() => {
    if (override) return override;
    return resolveDashboardPageMeta(pathname ?? "/dashboard");
  }, [override, pathname]);

  return (
    <DashboardShell
      title={meta.title}
      subtitle={meta.subtitle}
      icon={meta.icon}
      hidePageHeader={meta.hidePageHeader}
      fullBleed={meta.fullBleed}
    >
      {children}
    </DashboardShell>
  );
}

/** Single persistent dashboard chrome for all /dashboard routes. */
export function DashboardLayoutShell({ children }: { children: ReactNode }) {
  return (
    <DashboardPageMetaProvider>
      <DashboardLayoutShellInner>{children}</DashboardLayoutShellInner>
    </DashboardPageMetaProvider>
  );
}
