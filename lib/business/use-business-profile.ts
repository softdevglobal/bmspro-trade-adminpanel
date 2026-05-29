"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { db } from "@/lib/firebase/client";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";

export type BusinessProfileLite = {
  businessName: string | null;
  logoUrl: string | null;
};

/**
 * Live subscription to the signed-in owner's business doc, exposing just the
 * name and logo for dashboard chrome (sidebar, header). Returns null until the
 * owner's business is known.
 */
export function useBusinessProfile(): BusinessProfileLite | null {
  const { role, businessId } = useAuth();
  const [profile, setProfile] = useState<BusinessProfileLite | null>(null);

  useEffect(() => {
    if (role !== "business_owner" || !businessId) {
      setProfile(null);
      return;
    }
    const ref = doc(db, "businesses", businessId);
    const unsubscribe = onSnapshot(ref, (snap) => {
      const data = snap.data();
      if (!data) {
        setProfile(null);
        return;
      }
      setProfile({
        businessName:
          typeof data.businessName === "string" ? data.businessName : null,
        logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
      });
    });
    return () => unsubscribe();
  }, [role, businessId]);

  return profile;
}
