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

function needsInspectionFeed(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

type InspectionRequestsValue = {
  requests: InspectionRequestDetail[];
  loading: boolean;
  error: string | null;
};

type InspectionRequestsSnapshot = {
  businessId: string;
  requests: InspectionRequestDetail[];
};

type InspectionRequestsError = {
  businessId: string;
  message: string;
};

const InspectionRequestsContext =
  createContext<InspectionRequestsValue | null>(null);

/** Streams dashboard request updates through one shared Firestore listener. */
export function InspectionRequestsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();
  const [snapshot, setSnapshot] = useState<InspectionRequestsSnapshot | null>(
    null,
  );
  const [snapshotError, setSnapshotError] =
    useState<InspectionRequestsError | null>(null);

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsInspectionFeed(pathname) &&
    pageVisible;

  useEffect(() => {
    if (!enabled || !businessId) {
      return;
    }

    const unsubscribe = subscribeBusinessInspectionRequests(
      businessId,
      (next) => {
        setSnapshot({ businessId, requests: next });
        setSnapshotError(null);
      },
      () => {
        setSnapshotError({
          businessId,
          message: "Could not load requests.",
        });
      },
    );

    return unsubscribe;
  }, [enabled, businessId]);

  const activeSnapshot =
    enabled && snapshot?.businessId === businessId ? snapshot : null;
  const activeError =
    enabled && snapshotError?.businessId === businessId
      ? snapshotError.message
      : null;

  const value = useMemo(
    () => ({
      requests: activeSnapshot?.requests ?? [],
      loading: enabled && !activeSnapshot && !activeError,
      error: activeError,
    }),
    [activeSnapshot, activeError, enabled],
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
