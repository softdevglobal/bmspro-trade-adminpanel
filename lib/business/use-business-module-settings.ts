"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  isBusinessModuleEnabled,
  LEGACY_BUSINESS_MODULE_DEFAULTS,
  type BusinessModuleKey,
  type BusinessModuleSettings,
} from "@/lib/business/module-settings";
import { useCallback, useEffect, useState } from "react";

export function useBusinessModuleSettings() {
  const { user, status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<BusinessModuleSettings>(
    LEGACY_BUSINESS_MODULE_DEFAULTS,
  );

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user) {
        if (active) {
          setLoading(false);
          setModules(LEGACY_BUSINESS_MODULE_DEFAULTS);
        }
        return;
      }

      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/business/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          profile?: { enabledModules?: BusinessModuleSettings };
        };
        if (!active) return;
        if (!response.ok || !payload.ok || !payload.profile?.enabledModules) {
          setModules(LEGACY_BUSINESS_MODULE_DEFAULTS);
          return;
        }
        setModules(payload.profile.enabledModules);
      } catch {
        if (active) setModules(LEGACY_BUSINESS_MODULE_DEFAULTS);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (status === "authenticated") {
      void load();
    } else if (status !== "loading") {
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [user, status]);

  const isModuleEnabled = useCallback(
    (module: BusinessModuleKey) => isBusinessModuleEnabled(modules, module),
    [modules],
  );

  return { loading, modules, isModuleEnabled };
}
