"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { subscribeBusinessInspectionRequests } from "@/lib/inspection/firestore-client";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { usePageVisible } from "@/lib/notifications/use-page-visible";
import { useEffect, useState } from "react";

/** Live inspection board feed (Firestore listener, no repeated /api/inspection-requests polls). */
export function useInspectionRequests(): {
  requests: InspectionRequestDetail[];
  loading: boolean;
  error: string | null;
} {
  const { role, businessId } = useAuth();
  const pageVisible = usePageVisible();
  const [requests, setRequests] = useState<InspectionRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = role === "business_owner" && Boolean(businessId);

  useEffect(() => {
    if (!enabled || !businessId) {
      setRequests([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!pageVisible) return;

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeBusinessInspectionRequests(
      businessId,
      (next) => {
        setRequests(next);
        setLoading(false);
        setError(null);
      },
      () => {
        setError("Could not load inspection requests.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [enabled, businessId, pageVisible]);

  return { requests, loading, error };
}
