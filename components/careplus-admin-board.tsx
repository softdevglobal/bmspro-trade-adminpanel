"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { summarizeCareplusOutbox } from "@/lib/integrations/careplus/outbox-summary";
import type { CareplusOutboxRecord } from "@/lib/integrations/careplus/types";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { useCallback, useEffect, useMemo, useState } from "react";

function statusBadge(status: string): string {
  if (status === "active" || status === "sent" || status === "applied") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (
    status === "pending" ||
    status === "retry" ||
    status === "correction_required" ||
    status === "pending_mapping" ||
    status === "pending_review"
  ) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  if (status === "revoked" || status === "rejected" || status === "failed") {
    return "bg-red-50 text-red-800 border-red-200";
  }
  return "bg-stone-100 text-stone-600 border-stone-200";
}

function formatWhen(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CareplusAdminBoard() {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [outbox, setOutbox] = useState<CareplusOutboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    if (!user) throw new Error("Please sign in again.");
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [user]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setDeliveryError(null);
    try {
      const headers = await authHeaders();
      const [tenantsRes, outboxRes] = await Promise.all([
        fetch("/api/admin/tenants", { headers, cache: "no-store" }),
        fetch("/api/admin/careplus/outbox", { headers, cache: "no-store" }),
      ]);
      const tenantsData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        tenants?: TenantDetail[];
      }>(tenantsRes);
      const outboxData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        outbox?: CareplusOutboxRecord[];
      }>(outboxRes);
      if (!tenantsRes.ok || !tenantsData.ok) {
        throw new Error(tenantsData.error ?? "Could not load tenants.");
      }
      if (!outboxRes.ok || !outboxData.ok) {
        throw new Error(outboxData.error ?? "Could not load CarePlus records.");
      }
      setTenants(tenantsData.tenants ?? []);
      setOutbox(outboxData.outbox ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load CarePlus records.",
      );
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const deliveryCounts = useMemo(() => {
    const summary = summarizeCareplusOutbox(outbox);
    return {
      ...summary,
      tenantFailed: outbox.filter(
        (row) =>
          row.origin === "tenant" &&
          (row.status === "failed" ||
            row.status === "retry" ||
            row.status === "pending"),
      ).length,
      lastSuccess:
        outbox
          .filter(
            (row) =>
              row.status === "sent" || row.processingStatus === "applied",
          )
          .map((row) => row.sentAt)
          .filter((value): value is number => typeof value === "number")
          .sort((a, b) => b - a)[0] ?? null,
    };
  }, [outbox]);

  const tenantName = useCallback(
    (id: string) =>
      tenants.find((tenant) => tenant.id === id)?.businessName || id,
    [tenants],
  );

  async function retryEvent(eventId: string) {
    setDeliveryMessage(null);
    setDeliveryError(null);
    const headers = await authHeaders();
    const response = await fetch("/api/admin/careplus/outbox", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", eventId }),
    });
    const data = await readJsonResponse<{
      ok?: boolean;
      error?: string;
      scanned?: number;
      sent?: number;
      failed?: number;
      retried?: number;
    }>(response);
    if (!response.ok || !data.ok) {
      setDeliveryError(data.error ?? "Could not retry that event.");
      return;
    }
    const sent = data.sent ?? 0;
    const failed = data.failed ?? 0;
    const retried = data.retried ?? 0;
    if (failed > 0 || retried > 0) {
      setDeliveryError(
        `Retry sent ${sent}, ${retried} will retry, ${failed} failed. CarePlus is still returning an error — check the CarePlus server log.`,
      );
    } else if (sent > 0) {
      setDeliveryMessage(
        `Sent ${sent} event${sent === 1 ? "" : "s"} to CarePlus.`,
      );
    } else {
      setDeliveryMessage("Event sent again.");
    }
    try {
      await load();
    } catch (err) {
      setDeliveryError(
        err instanceof Error ? err.message : "Could not refresh records.",
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="max-w-3xl font-body text-[14px] text-on-surface-variant">
        Super Admin only. Review records businesses sent to CarePlus. Retry a
        row if delivery failed. Tenant, staff, customer and training mapping is
        no longer managed here.
      </p>

      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 font-body text-[13px] text-on-error-container">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Pending / retry", deliveryCounts.pending],
          ["Applied", deliveryCounts.applied],
          ["Waiting", deliveryCounts.awaiting],
          ["Rejected / correction", deliveryCounts.rejected],
        ].map(([label, count]) => (
          <div
            key={label}
            className="rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-4 py-3"
          >
            <p className="font-body text-[12px] text-on-surface-variant">{label}</p>
            <p className="font-headline text-[22px] text-on-surface">{count}</p>
          </div>
        ))}
      </div>
      <p className="font-body text-[13px] text-on-surface-variant">
        Last successful send: {formatWhen(deliveryCounts.lastSuccess)}
      </p>
      {deliveryCounts.tenantFailed > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
          {deliveryCounts.tenantFailed} business record
          {deliveryCounts.tenantFailed === 1 ? "" : "s"} failed to reach
          CarePlus. Use Retry on those rows.
        </p>
      ) : null}
      {deliveryError ? (
        <p className="font-body text-[13px] text-error">{deliveryError}</p>
      ) : null}
      {deliveryMessage ? (
        <p className="font-body text-[13px] text-emerald-700">
          {deliveryMessage}
        </p>
      ) : null}
      <section className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
        <div className="max-h-[min(36rem,65vh)] overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-surface-container font-body text-[12px] text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">CarePlus</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="font-body text-[13px]">
              {outbox.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-on-surface-variant" colSpan={7}>
                    No CarePlus records yet.
                  </td>
                </tr>
              ) : (
                outbox.map((row) => (
                  <tr
                    key={row.eventId}
                    className="border-t border-outline-variant/60"
                  >
                    <td className="px-4 py-3 font-mono text-[12px]">
                      {row.eventId}
                    </td>
                    <td className="px-4 py-3">
                      <div>{row.eventType}</div>
                      {row.origin === "tenant" ? (
                        <div className="text-[11px] text-on-surface-variant">
                          From business
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{tenantName(row.businessId)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(row.processingStatus || row.status)}`}
                      >
                        {row.processingStatus || row.status}
                        {row.lastErrorCode ? ` · ${row.lastErrorCode}` : ""}
                      </span>
                      {row.corrections.length > 0 ? (
                        <p className="mt-1 text-[12px] text-amber-800">
                          {row.corrections.map((item) => item.message).join(" ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px]">
                      {row.careplusResource || "—"}
                    </td>
                    <td className="px-4 py-3">{row.attempts}</td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "failed" ||
                      row.status === "retry" ||
                      row.status === "pending" ||
                      row.processingStatus === "correction_required" ||
                      row.processingStatus === "pending_mapping" ||
                      (row.status === "sent" &&
                        row.processingStatus === "accepted" &&
                        !row.careplusResource) ? (
                        <button
                          type="button"
                          onClick={() => void retryEvent(row.eventId)}
                          className="font-body text-[12px] text-primary"
                        >
                          Retry
                        </button>
                      ) : (
                        <span className="text-on-surface-variant">
                          {formatWhen(row.sentAt ?? row.createdAt)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
