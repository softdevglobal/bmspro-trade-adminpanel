"use client";

import { useAuth } from "@/lib/auth/auth-context";
import type { LeaveRequestRecord } from "@/lib/leave/types";
import { usePollingFetch } from "@/lib/data/use-polling-fetch";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

function needsLeaveFeed(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

type LeaveRequestsValue = {
  leaveRequests: LeaveRequestRecord[];
  pendingCount: number;
  loading: boolean;
  error: string | null;
};

const LeaveRequestsContext = createContext<LeaveRequestsValue | null>(null);

async function fetchLeaveRequests(token: string): Promise<LeaveRequestRecord[]> {
  const response = await fetch("/api/leave-requests", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = (await response.json()) as {
    ok?: boolean;
    leaveRequests?: LeaveRequestRecord[];
    error?: string;
  };
  if (!response.ok || !body.ok || !body.leaveRequests) {
    throw new Error(body.error ?? "Could not load leave requests.");
  }
  return body.leaveRequests;
}

/** Polls leave requests via API to drive the sidebar pending badge. */
export function LeaveRequestsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsLeaveFeed(pathname) &&
    pageVisible;

  const { data, loading, error } = usePollingFetch({
    enabled,
    intervalMs: 90_000,
    fetcher: async () => {
      if (!user) return [];
      const token = await user.getIdToken();
      return fetchLeaveRequests(token);
    },
  });

  const value = useMemo(() => {
    const leaveRequests = data ?? [];
    return {
      leaveRequests,
      pendingCount: leaveRequests.filter((item) => item.status === "pending")
        .length,
      loading: enabled ? loading : false,
      error,
    };
  }, [data, loading, error, enabled]);

  return (
    <LeaveRequestsContext.Provider value={value}>
      {children}
    </LeaveRequestsContext.Provider>
  );
}

export function useLeaveRequests(): LeaveRequestsValue {
  const context = useContext(LeaveRequestsContext);
  if (!context) {
    return { leaveRequests: [], pendingCount: 0, loading: false, error: null };
  }
  return context;
}
