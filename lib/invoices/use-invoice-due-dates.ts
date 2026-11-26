"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { invoiceDueItems, type InvoiceDueItem } from "@/lib/invoices/calendar-due";
import type { InvoiceDetail } from "@/lib/invoices/types";
import { useCallback, useEffect, useMemo, useState } from "react";

async function fetchInvoices(token: string): Promise<InvoiceDetail[]> {
  const response = await fetch("/api/invoices", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    invoices?: InvoiceDetail[];
    error?: string;
  };
  if (!response.ok || !payload.ok || !payload.invoices) {
    throw new Error(payload.error ?? "Could not load invoice due dates.");
  }
  return payload.invoices;
}

/**
 * Issued invoices that still have money owed, for the calendar.
 * Loads nothing while [enabled] is false (the Invoices module is off).
 */
export function useInvoiceDueDates(
  enabled: boolean,
  timeZone?: string | null,
) {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const active = Boolean(user && enabled);

  useEffect(() => {
    if (!user || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchInvoices(await user.getIdToken());
        if (cancelled) return;
        setInvoices(list);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setInvoices([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load invoice due dates.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, enabled, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const items: InvoiceDueItem[] = useMemo(
    () => (active ? invoiceDueItems(invoices, timeZone) : []),
    [active, invoices, timeZone],
  );

  return { items, error: active ? error : null, reload };
}
