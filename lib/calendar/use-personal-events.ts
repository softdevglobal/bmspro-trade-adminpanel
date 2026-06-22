"use client";

import type { PersonalCalendarEvent } from "@/lib/calendar/personal-events/types";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useState } from "react";

export function usePersonalCalendarEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<PersonalCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/calendar/personal-events", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        events?: PersonalCalendarEvent[];
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.events) {
        throw new Error(payload.error ?? "Could not load personal events.");
      }
      setEvents(payload.events);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load personal events.",
      );
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { events, loading, error, reload };
}
