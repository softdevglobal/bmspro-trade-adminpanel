"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import {
  isBusinessModuleEnabled,
  LEGACY_BUSINESS_MODULE_DEFAULTS,
  type BusinessModuleKey,
  type BusinessModuleSettings,
} from "@/lib/business/module-settings";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const MODULES_CACHE_KEY = "bms.business.modules";
const MODULES_CACHE_TTL_MS = 10 * 60 * 1000;

type ModulesCache = {
  businessId: string;
  modules: BusinessModuleSettings;
  cachedAt: number;
};

function readModulesCache(businessId: string): BusinessModuleSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MODULES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModulesCache;
    if (parsed.businessId !== businessId) return null;
    if (Date.now() - parsed.cachedAt > MODULES_CACHE_TTL_MS) return null;
    return parsed.modules;
  } catch {
    return null;
  }
}

function writeModulesCache(
  businessId: string,
  modules: BusinessModuleSettings,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      MODULES_CACHE_KEY,
      JSON.stringify({
        businessId,
        modules,
        cachedAt: Date.now(),
      } satisfies ModulesCache),
    );
  } catch {
    /* ignore */
  }
}

type BusinessModuleSettingsContextValue = {
  loading: boolean;
  modulesReady: boolean;
  modules: BusinessModuleSettings;
  isModuleEnabled: (module: BusinessModuleKey) => boolean;
  canUseModule: (module: BusinessModuleKey) => boolean;
  applyModules: (modules: BusinessModuleSettings) => void;
};

const BusinessModuleSettingsContext =
  createContext<BusinessModuleSettingsContextValue | null>(null);

export function BusinessModuleSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, status, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const cachedModules = businessId ? readModulesCache(businessId) : null;
  const [loading, setLoading] = useState(() => Boolean(businessId && !cachedModules));
  const [modules, setModules] = useState<BusinessModuleSettings>(
    () => cachedModules ?? LEGACY_BUSINESS_MODULE_DEFAULTS,
  );

  const applyModules = useCallback(
    (next: BusinessModuleSettings) => {
      setModules(next);
      if (businessId) writeModulesCache(businessId, next);
      setLoading(false);
    },
    [businessId],
  );

  const loadModules = useCallback(async () => {
    if (!user || !businessId) {
      setLoading(false);
      setModules(LEGACY_BUSINESS_MODULE_DEFAULTS);
      return;
    }

    const hadCache = readModulesCache(businessId) !== null;
    if (!hadCache) setLoading(true);

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
      if (!response.ok || !payload.ok || !payload.profile?.enabledModules) {
        return;
      }
      applyModules(payload.profile.enabledModules);
    } catch {
      /* keep cached or legacy modules */
    } finally {
      setLoading(false);
    }
  }, [user, businessId, applyModules]);

  useEffect(() => {
    if (status === "authenticated" && businessId && pageVisible) {
      const cached = readModulesCache(businessId);
      if (cached) {
        setModules(cached);
        setLoading(false);
      }
      void loadModules();
      return;
    }
    if (status !== "loading") {
      setLoading(false);
    }
  }, [status, businessId, pageVisible, loadModules]);

  const isModuleEnabled = useCallback(
    (module: BusinessModuleKey) => isBusinessModuleEnabled(modules, module),
    [modules],
  );

  const modulesReady = !loading;

  const canUseModule = useCallback(
    (module: BusinessModuleKey) =>
      modulesReady && isBusinessModuleEnabled(modules, module),
    [modules, modulesReady],
  );

  const value = useMemo(
    () => ({
      loading,
      modulesReady,
      modules,
      isModuleEnabled,
      canUseModule,
      applyModules,
    }),
    [loading, modulesReady, modules, isModuleEnabled, canUseModule, applyModules],
  );

  return (
    <BusinessModuleSettingsContext.Provider value={value}>
      {children}
    </BusinessModuleSettingsContext.Provider>
  );
}

export function useBusinessModuleSettings(): BusinessModuleSettingsContextValue {
  const context = useContext(BusinessModuleSettingsContext);
  if (!context) {
    throw new Error(
      "useBusinessModuleSettings must be used within BusinessModuleSettingsProvider",
    );
  }
  return context;
}
