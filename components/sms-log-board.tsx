"use client";

import { SmsDeliveryLog } from "@/components/sms-delivery-log";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type { SmsLogEntry } from "@/lib/sms/sms-log-types";
import { useCallback, useEffect, useState } from "react";

type SmsLogBoardProps = {
  variant: "admin" | "tenant";
};

export function SmsLogBoard({ variant }: SmsLogBoardProps) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<SmsLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const endpoint =
    variant === "admin" ? "/api/sms/log" : "/api/business/sms/log";

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        logs?: SmsLogEntry[];
        error?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        setLogs([]);
        setError(data.error ?? "Could not load SMS log.");
        return;
      }
      setLogs(data.logs ?? []);
    } catch {
      setError("Could not load SMS log.");
    } finally {
      setLoading(false);
    }
  }, [endpoint, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading SMS log…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      <SmsDeliveryLog logs={logs} variant={variant} showHeader={false} />
    </div>
  );
}
