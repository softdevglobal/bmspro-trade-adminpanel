"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { db } from "@/lib/firebase/client";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { doc, onSnapshot } from "firebase/firestore";
import {
  createContext,
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
    return parsed.profile;
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

/** One Firestore listener for the business doc (sidebar + header share this). */
export function BusinessProfileProvider({ children }: { children: ReactNode }) {
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [profile, setProfile] = useState<BusinessProfileLite | null>(() =>
    businessId && role === "business_owner"
      ? readProfileCache(businessId)
      : null,
  );

  useEffect(() => {
    if (role !== "business_owner" || !businessId) {
      setProfile(null);
      return;
    }
    if (!pageVisible) return;

    const cached = readProfileCache(businessId);
    if (cached) setProfile(cached);

    const ref = doc(db, "businesses", businessId);
    const unsubscribe = onSnapshot(ref, (snap) => {
      const data = snap.data();
      if (!data) {
        setProfile(null);
        return;
      }
      const slug =
        typeof data.bookingSlug === "string" ? data.bookingSlug : null;
      const next: BusinessProfileLite = {
        businessName:
          typeof data.businessName === "string" ? data.businessName : null,
        logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
        bookingSlug: slug,
        bookingPath:
          typeof data.bookingPath === "string"
            ? data.bookingPath
            : slug
              ? `/booknow/${slug}`
              : null,
      };
      writeProfileCache(businessId, next);
      setProfile(next);
    });

    return () => unsubscribe();
  }, [role, businessId, pageVisible]);

  const value = useMemo(() => profile, [profile]);

  return (
    <BusinessProfileContext.Provider value={value}>
      {children}
    </BusinessProfileContext.Provider>
  );
}

export function useBusinessProfile(): BusinessProfileLite | null {
  return useContext(BusinessProfileContext);
}
