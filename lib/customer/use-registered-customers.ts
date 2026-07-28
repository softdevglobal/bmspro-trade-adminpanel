"use client";

import { useAuth } from "@/lib/auth/auth-context";
import type { CustomerProfile } from "@/lib/customer/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Loads registered business customers from `/api/customers`.
 * Used so create job/request/quotation/invoice dropdowns match the Customers tab.
 */
export function useRegisteredCustomers(): {
  customers: CustomerProfile[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setCustomers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customers", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        customers?: CustomerProfile[];
      };
      if (response.ok && data.ok) {
        setCustomers(data.customers ?? []);
      }
    } catch {
      // Keep prior list when the registry cannot load.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { customers, loading, reload };
}
