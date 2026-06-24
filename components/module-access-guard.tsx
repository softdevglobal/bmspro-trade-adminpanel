"use client";

import { ModuleDisabledMessage } from "@/components/business-module-settings";
import { useBusinessModuleSettings } from "@/lib/business/use-business-module-settings";
import type { BusinessModuleKey } from "@/lib/business/module-settings";
import { useAuth } from "@/lib/auth/auth-context";

type ToggleableModule = Exclude<BusinessModuleKey, "requests">;

export function ModuleAccessGuard({
  module,
  children,
}: {
  module: ToggleableModule;
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const { loading, isModuleEnabled } = useBusinessModuleSettings();
  const enabled = isModuleEnabled(module);

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
