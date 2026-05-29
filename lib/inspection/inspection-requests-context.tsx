"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { subscribeBusinessInspectionRequests } from "@/lib/inspection/firestore-client";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const INSPECTION_ROUTES = [
  "/dashboard/inspection-visits",
  "/dashboard/customers",
] as const;

function needsInspectionFeed(pathname: string | null): boolean {
  if (!pathname) return false;
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

/**
 * Subscribes to inspection_requests only on visits + customers pages
 * (not on every dashboard route).
 */
export function InspectionRequestsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [requests, setRequests] = useState<InspectionRequestDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    needsInspectionFeed(pathname);

  useEffect(() => {
    if (!enabled || !businessId) {
      setRequests([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeBusinessInspectionRequests(
      businessId,
      (next) => {
        setRequests(next);
        setLoading(false);
        setError(null);
      },
      () => {
        setError("Could not load inspection requests.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible]);

  const value = useMemo(
    () => ({ requests, loading: enabled ? loading : false, error }),
    [requests, loading, error, enabled],
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
