"use client";

import type { DashboardPageMeta } from "@/lib/dashboard/page-meta";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type DashboardPageMetaContextValue = {
  override: DashboardPageMeta | null;
  setOverride: (meta: DashboardPageMeta | null) => void;
};

const DashboardPageMetaContext =
  createContext<DashboardPageMetaContextValue | null>(null);

export function DashboardPageMetaProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<DashboardPageMeta | null>(null);
  const value = useMemo(
    () => ({ override, setOverride }),
    [override],
  );

  return (
    <DashboardPageMetaContext.Provider value={value}>
      {children}
    </DashboardPageMetaContext.Provider>
  );
}

export function useDashboardPageMetaOverride(meta: DashboardPageMeta | null) {
  const context = useContext(DashboardPageMetaContext);
  if (!context) {
    throw new Error(
      "useDashboardPageMetaOverride must be used within DashboardPageMetaProvider",
    );
  }

  const { setOverride } = context;

  useEffect(() => {
    setOverride(meta);
    return () => setOverride(null);
  }, [meta, setOverride]);
}

export function useDashboardPageMetaOverrideState() {
  const context = useContext(DashboardPageMetaContext);
  return context?.override ?? null;
}
