"use client";

import { useAuth } from "@/lib/auth/auth-context";
import type { BusinessServiceDetail } from "@/lib/onboarding/services/display";
import { useCallback, useEffect, useState } from "react";

export type CalendarServiceOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export function useCalendarFilterOptions(enabled: boolean) {
  const { user, businessId, role } = useAuth();
  const [services, setServices] = useState<CalendarServiceOption[]>([]);
  const [serviceAreas, setServiceAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !businessId || role !== "business_owner") {
      setServices([]);
      setServiceAreas([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const [servicesResponse, profileResponse] = await Promise.all([
        fetch("/api/services", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/business/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const servicesPayload = (await servicesResponse.json()) as {
        ok?: boolean;
        services?: BusinessServiceDetail[];
        error?: string;
      };

      if (!servicesResponse.ok || !servicesPayload.ok) {
        throw new Error(
          servicesPayload.error ?? "Could not load services.",
        );
      }

      setServices(
        (servicesPayload.services ?? [])
          .map((service) => ({
            id: service.id,
            name: service.name,
            isActive: service.isActive,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      const profilePayload = (await profileResponse.json()) as {
        ok?: boolean;
        profile?: { serviceAreas?: string[] };
        error?: string;
      };

      if (!profileResponse.ok || !profilePayload.ok) {
        throw new Error(
          profilePayload.error ?? "Could not load business profile.",
        );
      }

      setServiceAreas(
        Array.isArray(profilePayload.profile?.serviceAreas)
          ? profilePayload.profile!.serviceAreas!
              .filter((area): area is string => typeof area === "string")
              .map((area) => area.trim())
              .filter(Boolean)
          : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load filter options.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, businessId, role]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { services, serviceAreas, loading, error, reload: load };
}
