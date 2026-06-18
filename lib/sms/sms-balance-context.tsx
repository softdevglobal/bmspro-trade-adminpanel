"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { usePollingFetch } from "@/lib/data/use-polling-fetch";
import type { BusinessSmsBalance } from "@/lib/sms-packages/balance";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

function needsSmsBalance(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

type SmsBalanceValue = {
  balance: BusinessSmsBalance | null;
  loading: boolean;
  error: string | null;
  remaining: number | null;
  isLow: boolean;
  refresh: () => Promise<void>;
};

const SmsBalanceContext = createContext<SmsBalanceValue | null>(null);

async function fetchSmsBalance(token: string): Promise<BusinessSmsBalance> {
  const response = await fetch("/api/business/sms", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = (await response.json()) as {
    ok?: boolean;
    balance?: BusinessSmsBalance;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.balance) {
    throw new Error(body.error ?? "Could not load SMS balance.");
  }
  return body.balance;
}

/** Polls SMS balance for the owner sidebar badge and low-balance warning. */
export function SmsBalanceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();

  const enabled =
    role === "business_owner" &&
    Boolean(businessId) &&
    Boolean(user) &&
    needsSmsBalance(pathname) &&
    pageVisible;

  const { data, loading, error, refresh } = usePollingFetch({
    enabled,
    intervalMs: 60_000,
    fetcher: async () => {
      if (!user) {
        throw new Error("Not signed in.");
      }
      const token = await user.getIdToken();
      return fetchSmsBalance(token);
    },
  });

  const value = useMemo(() => {
    const balance = data ?? null;
    return {
      balance,
      loading: enabled ? loading : false,
      error,
      remaining: balance?.remaining ?? null,
      isLow: balance?.isLow === true,
      refresh,
    };
  }, [data, loading, error, enabled, refresh]);

  return (
    <SmsBalanceContext.Provider value={value}>
      {children}
    </SmsBalanceContext.Provider>
  );
}

export function useSmsBalance(): SmsBalanceValue {
  const context = useContext(SmsBalanceContext);
  if (!context) {
    return {
      balance: null,
      loading: false,
      error: null,
      remaining: null,
      isLow: false,
      refresh: async () => {},
    };
  }
  return context;
}
