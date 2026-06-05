"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { fetchBusinessInspectionRequests } from "@/lib/inspection/api-client";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { usePollingFetch } from "@/lib/data/use-polling-fetch";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

const INSPECTION_ROUTES = [
  "/dashboard/inspection-visits",
  "/dashboard/customers",
  "/dashboard/calendar",
] as const;

function needsInspectionFeed(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/dashboard" || pathname === "/dashboard/") return true;
  return INSPECTION_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

type InspectionRequestsValue = {
  requests: InspectionRequestDetail[];
  loading: boolean;
  error: string | null;
};

const InspectionRequestsContext =
  createContext<InspectionRequestsValue | null>(null);

/** Polls inspection_requests via API (no Firestore snapshot listener). */
export function InspectionRequestsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsInspectionFeed(pathname) &&
    pageVisible;

  const { data, loading, error } = usePollingFetch({
    enabled,
    intervalMs: 90_000,
    fetcher: async () => {
      if (!user) return [];
      const token = await user.getIdToken();
      return fetchBusinessInspectionRequests(token);
    },
  });

  const value = useMemo(
    () => ({
      requests: data ?? [],
      loading: enabled ? loading : false,
      error,
    }),
    [data, loading, error, enabled],
  );

  return (
    <InspectionRequestsContext.Provider value={value}>
      {children}
    </InspectionRequestsContext.Provider>
  );
}

export function useInspectionRequests(): InspectionRequestsValue {
  const context = useContext(InspectionRequestsContext);
  if (!context) {
    throw new Error(
      "useInspectionRequests must be used within InspectionRequestsProvider",
    );
  }
  return context;
}
