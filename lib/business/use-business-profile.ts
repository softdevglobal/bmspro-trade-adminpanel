"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { db } from "@/lib/firebase/client";
import { doc, onSnapshot } from "firebase/firestore";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { useEffect, useState } from "react";

export type BusinessProfileLite = {
  businessName: string | null;
  logoUrl: string | null;
  bookingSlug: string | null;
  bookingPath: string | null;
};

/**
 * Live subscription to the signed-in owner's business doc, exposing just the
 * name and logo for dashboard chrome (sidebar, header). Returns null until the
 * owner's business is known.
 */
export function useBusinessProfile(): BusinessProfileLite | null {
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [profile, setProfile] = useState<BusinessProfileLite | null>(null);

  useEffect(() => {
    if (role !== "business_owner" || !businessId) {
      setProfile(null);
      return;
    }
    if (!pageVisible) return;
    const ref = doc(db, "businesses", businessId);
    const unsubscribe = onSnapshot(ref, (snap) => {
      const data = snap.data();
      if (!data) {
        setProfile(null);
        return;
      }
      const slug =
        typeof data.bookingSlug === "string" ? data.bookingSlug : null;
      setProfile({
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
      });
    });
    return () => unsubscribe();
  }, [role, businessId, pageVisible]);

  return profile;
}
