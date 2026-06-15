"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type BusinessProfileLite = {
  businessName: string | null;
  logoUrl: string | null;
  bookingSlug: string | null;
  bookingPath: string | null;
  timezone: string;
};

const PROFILE_CACHE_KEY = "bms.business.profile";
const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

type ProfileCache = {
  businessId: string;
  profile: BusinessProfileLite;
  cachedAt: number;
};

function readProfileCache(businessId: string): BusinessProfileLite | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileCache;
    if (parsed.businessId !== businessId) return null;
    if (Date.now() - parsed.cachedAt > PROFILE_CACHE_TTL_MS) return null;
    return {
      ...parsed.profile,
      timezone:
        typeof parsed.profile.timezone === "string" && parsed.profile.timezone
          ? parsed.profile.timezone
          : PLATFORM_TIME_ZONE,
    };
  } catch {
    return null;
  }
}

function writeProfileCache(businessId: string, profile: BusinessProfileLite): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ businessId, profile, cachedAt: Date.now() } satisfies ProfileCache),
    );
  } catch {
    /* ignore */
  }
}

const BusinessProfileContext = createContext<BusinessProfileLite | null>(null);
const BusinessProfileActionsContext = createContext<{
  mergeBusinessProfile: (profile: Partial<BusinessProfileLite>) => void;
} | null>(null);

/** Loads business profile via API on demand (no Firestore listener). */
export function BusinessProfileProvider({ children }: { children: ReactNode }) {
  const { role, businessId, user } = useAuth();
  const pageVisible = usePageVisible();
  const [profile, setProfile] = useState<BusinessProfileLite | null>(() =>
    businessId && role === "business_owner"
      ? readProfileCache(businessId)
      : null,
  );

  const loadProfile = useCallback(async () => {
    if (role !== "business_owner" || !businessId || !user) {
      setProfile(null);
      return;
    }
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await response.json()) as {
        ok: boolean;
        profile?: {
          businessName: string | null;
          logoUrl: string | null;
          bookingSlug?: string | null;
          bookingPath?: string | null;
          timezone?: string | null;
        };
      };
      if (!response.ok || !body.ok || !body.profile) return;

      const slug =
        typeof body.profile.bookingSlug === "string"
          ? body.profile.bookingSlug
          : null;
      const next: BusinessProfileLite = {
        businessName: body.profile.businessName,
        logoUrl: body.profile.logoUrl,
        bookingSlug: slug,
        bookingPath:
          typeof body.profile.bookingPath === "string"
            ? body.profile.bookingPath
            : slug
              ? `/booknow/${slug}`
              : null,
        timezone:
          typeof body.profile.timezone === "string" && body.profile.timezone
            ? body.profile.timezone
            : PLATFORM_TIME_ZONE,
      };
      writeProfileCache(businessId, next);
      setProfile(next);
    } catch {
      /* keep cached profile */
    }
  }, [role, businessId, user]);

  useEffect(() => {
    if (role !== "business_owner" || !businessId) {
      setProfile(null);
      return;
    }
    if (!pageVisible) return;

    const cached = readProfileCache(businessId);
    if (cached) setProfile(cached);

    void loadProfile();

    const onFocus = () => void loadProfile();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void loadProfile(), 300_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [role, businessId, pageVisible, loadProfile]);

  const mergeBusinessProfile = useCallback(
    (patch: Partial<BusinessProfileLite>) => {
      if (role !== "business_owner" || !businessId) return;
      setProfile((current) => {
        const next: BusinessProfileLite = {
          businessName: current?.businessName ?? null,
          logoUrl: current?.logoUrl ?? null,
          bookingSlug: current?.bookingSlug ?? null,
          bookingPath: current?.bookingPath ?? null,
          timezone: current?.timezone ?? PLATFORM_TIME_ZONE,
          ...patch,
        };
        writeProfileCache(businessId, next);
        return next;
      });
    },
    [role, businessId],
  );

  const value = useMemo(() => profile, [profile]);
  const actions = useMemo(
    () => ({ mergeBusinessProfile }),
    [mergeBusinessProfile],
  );

  return (
    <BusinessProfileActionsContext.Provider value={actions}>
      <BusinessProfileContext.Provider value={value}>
        {children}
      </BusinessProfileContext.Provider>
    </BusinessProfileActionsContext.Provider>
  );
}

export function useBusinessProfile(): BusinessProfileLite | null {
  return useContext(BusinessProfileContext);
}

export function useBusinessProfileActions() {
  return useContext(BusinessProfileActionsContext);
}
