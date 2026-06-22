"use client";

import type { DaySlotOccupancy } from "@/lib/calendar/slot-occupancy-types";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useState } from "react";

export function useCalendarSlotOccupancy(
  isoDate: string,
  /** Refetch when scheduled items on this day change. */
  refreshKey: string | number = 0,
) {
  const { user } = useAuth();
  const [data, setData] = useState<DaySlotOccupancy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user || !isoDate) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/calendar/slot-occupancy?date=${encodeURIComponent(isoDate)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        date?: string;
        slots?: DaySlotOccupancy["slots"];
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.slots) {
        throw new Error(payload.error ?? "Could not load slot capacity.");
      }

      setData({ date: payload.date ?? isoDate, slots: payload.slots });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load slot capacity.",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, isoDate]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return { slots: data?.slots, loading, error, reload };
}
