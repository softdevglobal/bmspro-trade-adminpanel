"use client";

import {
  DEFAULT_WORKING_HOURS,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useState } from "react";

type WorkingHoursState = {
  workingHours: BusinessWorkingHours;
  loading: boolean;
};

export function useBusinessWorkingHours(): WorkingHoursState & {
  reload: () => Promise<void>;
} {
  const { user } = useAuth();
  const [state, setState] = useState<WorkingHoursState>({
    workingHours: DEFAULT_WORKING_HOURS,
    loading: true,
  });

  const reload = useCallback(async () => {
    if (!user) {
      setState({ workingHours: DEFAULT_WORKING_HOURS, loading: false });
      return;
    }

    setState((current) => ({ ...current, loading: true }));
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        profile?: {
          workingHours?: {
            startTime?: string | null;
            endTime?: string | null;
          } | null;
        };
      };
      if (!response.ok || !payload.ok || !payload.profile?.workingHours) {
        setState({ workingHours: DEFAULT_WORKING_HOURS, loading: false });
        return;
      }

      const { startTime, endTime } = payload.profile.workingHours;
      if (typeof startTime === "string" && typeof endTime === "string") {
        setState({
          workingHours: { startTime, endTime },
          loading: false,
        });
        return;
      }

      setState({ workingHours: DEFAULT_WORKING_HOURS, loading: false });
    } catch {
      setState((current) => ({ ...current, loading: false }));
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
