"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  STAFF_CHANGED_EVENT,
  clearStaffSummaryCache,
  readStaffSummaryCache,
  writeStaffSummaryCache,
  type StaffSummary,
} from "@/lib/team/staff-summary-cache";
import { useCallback, useEffect, useState } from "react";

/**
 * Lightweight staff list for the inspection board (cached 5 min, summary API).
 * Full staff management still uses /api/team/staff on the team page.
 */
export function useBusinessStaffSummary(): {
  staff: StaffSummary[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const { user, role, businessId } = useAuth();
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!user || role !== "business_owner" || !businessId) {
        setStaff([]);
        return;
      }

      if (!force) {
        const cached = readStaffSummaryCache(businessId);
        if (cached) {
          setStaff(
            cached.map((member) => ({
              ...member,
              canget_qutaion: member.canget_qutaion === true,
            })),
          );
          return;
        }
      }

      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/team/staff?summary=1", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          staff?: {
            id: string;
            fullName: string;
            email: string;
            staffType?: string;
            status?: string;
            canget_qutaion?: boolean;
          }[];
        };
        if (!response.ok || !payload.ok) return;
        const next = (payload.staff ?? [])
          .filter((member) => member.status !== "suspended")
          .map((member) => ({
            id: member.id,
            fullName: member.fullName,
            email: member.email,
            staffType: member.staffType?.trim() || "Team member",
            canget_qutaion: member.canget_qutaion === true,
          }));
        setStaff(next);
        writeStaffSummaryCache(businessId, next);
      } finally {
        setLoading(false);
      }
    },
    [user, role, businessId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!businessId) return;
    const onChanged = () => {
      clearStaffSummaryCache(businessId);
      void load(true);
    };
    window.addEventListener(STAFF_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(STAFF_CHANGED_EVENT, onChanged);
  }, [businessId, load]);

  const reload = useCallback(async () => {
    if (businessId) clearStaffSummaryCache(businessId);
    await load(true);
  }, [businessId, load]);

  return { staff, loading, reload };
}
