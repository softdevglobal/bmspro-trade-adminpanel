"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  DEFAULT_WORKING_HOURS,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { useCallback, useEffect, useState } from "react";

type WorkingHoursState = {
  workingHours: BusinessWorkingHours;
  loading: boolean;
};

const WORKING_HOURS_CACHE_KEY = "bms.business.workingHours";
const WORKING_HOURS_CACHE_TTL_MS = 10 * 60 * 1000;

type WorkingHoursCache = {
  businessId: string;
  workingHours: BusinessWorkingHours;
  cachedAt: number;
};

function readWorkingHoursCache(
  businessId: string,
): BusinessWorkingHours | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WORKING_HOURS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkingHoursCache;
    if (parsed.businessId !== businessId) return null;
    if (Date.now() - parsed.cachedAt > WORKING_HOURS_CACHE_TTL_MS) {
      return null;
    }
    if (
      typeof parsed.workingHours?.startTime !== "string" ||
      typeof parsed.workingHours?.endTime !== "string"
    ) {
      return null;
    }
    return parsed.workingHours;
  } catch {
    return null;
  }
}

export function writeBusinessWorkingHoursCache(
  businessId: string,
  workingHours: BusinessWorkingHours,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      WORKING_HOURS_CACHE_KEY,
      JSON.stringify({
        businessId,
        workingHours,
        cachedAt: Date.now(),
      } satisfies WorkingHoursCache),
    );
  } catch {
    /* ignore */
  }
}

function createInitialState(businessId: string | null): WorkingHoursState {
  const cached = businessId ? readWorkingHoursCache(businessId) : null;
  return {
    workingHours: cached ?? DEFAULT_WORKING_HOURS,
    loading: !cached,
  };
}

export function useBusinessWorkingHours(): WorkingHoursState & {
  reload: () => Promise<void>;
} {
  const { user, businessId } = useAuth();
  const [state, setState] = useState<WorkingHoursState>(() =>
    createInitialState(businessId),
  );

  useEffect(() => {
    setState(createInitialState(businessId));
  }, [businessId]);

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
        const workingHours = { startTime, endTime };
        if (businessId) {
          writeBusinessWorkingHoursCache(businessId, workingHours);
        }
        setState({
          workingHours,
          loading: false,
        });
        return;
      }

      setState({ workingHours: DEFAULT_WORKING_HOURS, loading: false });
    } catch {
      setState((current) => ({ ...current, loading: false }));
    }
  }, [user, businessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
