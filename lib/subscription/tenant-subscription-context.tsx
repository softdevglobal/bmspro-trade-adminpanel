"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { isTenantSubscriptionAccessBlocked } from "@/lib/subscription-plans/access";
import type { TenantSubscriptionSnapshot } from "@/lib/subscription-plans/tenant-types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type TenantSubscriptionContextValue = {
  subscription: TenantSubscriptionSnapshot | null;
  accessBlocked: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const TenantSubscriptionContext =
  createContext<TenantSubscriptionContextValue | null>(null);

export function TenantSubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const enabled = role === "business_owner" && Boolean(user);
  const [subscription, setSubscription] =
    useState<TenantSubscriptionSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/business/subscription", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        subscription?: TenantSubscriptionSnapshot;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok || !data.subscription) {
        setSubscription(null);
        setError(data.error ?? "Could not load subscription.");
        return;
      }
      setSubscription(data.subscription);
    } catch {
      setSubscription(null);
      setError("Could not load subscription.");
    } finally {
      setLoading(false);
    }
  }, [enabled, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accessBlocked = useMemo(() => {
    if (!subscription) return false;
    return (
      subscription.accessBlocked ??
      isTenantSubscriptionAccessBlocked(subscription)
    );
  }, [subscription]);

  const value = useMemo(
    () => ({
      subscription,
      accessBlocked: enabled ? accessBlocked : false,
      loading: enabled ? loading : false,
      error: enabled ? error : null,
      refresh,
    }),
    [subscription, accessBlocked, enabled, loading, error, refresh],
  );

  return (
    <TenantSubscriptionContext.Provider value={value}>
      {children}
    </TenantSubscriptionContext.Provider>
  );
}

export function useTenantSubscription(): TenantSubscriptionContextValue {
  const context = useContext(TenantSubscriptionContext);
  if (!context) {
    return {
      subscription: null,
      accessBlocked: false,
      loading: false,
      error: null,
      refresh: async () => {},
    };
  }
  return context;
}
