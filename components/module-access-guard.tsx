"use client";

import { ModuleDisabledMessage } from "@/components/business-module-settings";
import { useAuth } from "@/lib/auth/auth-context";
import {
  isBusinessModuleEnabled,
  type BusinessModuleKey,
  type BusinessModuleSettings,
} from "@/lib/business/module-settings";
import { useEffect, useState } from "react";

type ToggleableModule = Exclude<BusinessModuleKey, "requests">;

export function ModuleAccessGuard({
  module,
  children,
}: {
  module: ToggleableModule;
  children: React.ReactNode;
}) {
  const { user, status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user) {
        if (active) {
          setLoading(false);
          setEnabled(false);
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
          setEnabled(true);
          return;
        }
        setEnabled(
          isBusinessModuleEnabled(payload.profile.enabledModules, module),
        );
      } catch {
        if (active) setEnabled(true);
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
  }, [user, status, module]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (!enabled) {
    return <ModuleDisabledMessage module={module} />;
  }

  return <>{children}</>;
}
