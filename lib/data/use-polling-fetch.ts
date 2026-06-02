"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UsePollingFetchOptions<T> = {
  enabled: boolean;
  /** Milliseconds between background refetches while enabled. */
  intervalMs?: number;
  fetcher: () => Promise<T>;
};

/**
 * Fetches once on enable, refetches on tab focus and on an interval.
 * Avoids Firestore snapshot listeners for list feeds.
 */
export function usePollingFetch<T>({
  enabled,
  intervalMs = 90_000,
  fetcher,
}: UsePollingFetchOptions<T>): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetcherRef.current();
      setData(next);
    } catch {
      setError("Could not load data.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    void refresh();

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    const interval = window.setInterval(() => void refresh(), intervalMs);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [enabled, intervalMs, refresh]);

  return { data, loading, error, refresh };
}
