"use client";

import type { BusinessClosure } from "@/lib/calendar/business-closures/types";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useState } from "react";

export function useBusinessClosures(fromDate: string, toDate: string) {
  const { user } = useAuth();
  const [closures, setClosures] = useState<BusinessClosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user || !fromDate || !toDate) {
      setClosures([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/calendar/business-closures?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        closures?: BusinessClosure[];
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not load business off days.");
      }

      setClosures(payload.closures ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load business off days.",
      );
      setClosures([]);
    } finally {
      setLoading(false);
    }
  }, [user, fromDate, toDate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { closures, loading, error, reload };
}
