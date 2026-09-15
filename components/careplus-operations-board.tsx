"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type { CareplusOutboxRecord } from "@/lib/integrations/careplus/types";
import { useCallback, useEffect, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function CareplusOperationsBoard() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [outbox, setOutbox] = useState<CareplusOutboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [eventType, setEventType] = useState<
    "incident.captured" | "complaint.captured" | "action.captured"
  >("incident.captured");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [immediateAction, setImmediateAction] = useState("");

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
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/careplus/records", {
        headers,
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        connected?: boolean;
        outbox?: CareplusOutboxRecord[];
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not load CarePlus records.");
      }
      setConnected(Boolean(data.connected));
      setOutbox(data.outbox ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load CarePlus.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setSaving(true);
    setOk(null);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/careplus/records", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          title,
          description,
          customerId,
          severity,
          immediateAction,
        }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(
        response,
      );
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not send the record.");
      }
      setOk("Queued for CarePlus. Check delivery status below.");
      setTitle("");
      setDescription("");
      setImmediateAction("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the record.");
    } finally {
      setSaving(false);
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
        Capture daily incidents, complaints and follow-up actions here. CarePlus
        checks participant and staff mappings, then holds assessment, reporting
        deadlines and audit history. Training stays in CarePlus.
      </p>
      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 font-body text-[13px] text-on-error-container">
          {error}
        </div>
      ) : null}
      {!connected ? (
        <p className="font-body text-[14px] text-on-surface-variant">
          CarePlus is not connected for this business yet. Ask the platform
          administrator to map this tenant and staff/customers first.
        </p>
      ) : (
        <section className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="font-headline text-[16px] text-on-surface">
            Send a record to CarePlus
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="font-body text-[12px] text-on-surface-variant">
              Type
              <select
                className={`${INPUT_CLASS} mt-1`}
                value={eventType}
                onChange={(event) =>
                  setEventType(
                    event.target.value as
                      | "incident.captured"
                      | "complaint.captured"
                      | "action.captured",
                  )
                }
              >
                <option value="incident.captured">Incident</option>
                <option value="complaint.captured">Complaint or feedback</option>
                <option value="action.captured">Follow-up action</option>
              </select>
            </label>
            <label className="font-body text-[12px] text-on-surface-variant">
              Title
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {eventType === "incident.captured" ? (
              <label className="font-body text-[12px] text-on-surface-variant">
                Severity
                <select
                  className={`${INPUT_CLASS} mt-1`}
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            ) : null}
            <label className="font-body text-[12px] text-on-surface-variant">
              BMS customer ID
              <input
                className={`${INPUT_CLASS} mt-1`}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="Required for incidents"
              />
            </label>
            <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
              What happened
              <textarea
                className={`${INPUT_CLASS} mt-1 min-h-[96px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {eventType === "incident.captured" ? (
              <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
                Immediate action taken
                <textarea
                  className={`${INPUT_CLASS} mt-1 min-h-[72px]`}
                  value={immediateAction}
                  onChange={(event) => setImmediateAction(event.target.value)}
                />
              </label>
            ) : null}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-50"
          >
            {saving ? "Queueing…" : "Send to CarePlus"}
          </button>
          {ok ? <p className="mt-2 font-body text-[12px] text-emerald-700">{ok}</p> : null}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
        <div className="border-b border-outline-variant/60 px-4 py-3">
          <h2 className="font-headline text-[16px] text-on-surface">
            Delivery and corrections
          </h2>
        </div>
        <table className="w-full text-left">
          <thead className="bg-surface-container font-body text-[12px] text-on-surface-variant">
            <tr>
              <th className="px-4 py-3 font-medium">Record</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Correction</th>
            </tr>
          </thead>
          <tbody className="font-body text-[13px]">
            {outbox.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-on-surface-variant" colSpan={3}>
                  No CarePlus deliveries yet.
                </td>
              </tr>
            ) : (
              outbox.map((row) => (
                <tr key={row.eventId} className="border-t border-outline-variant/60">
                  <td className="px-4 py-3">
                    <div>{row.eventType}</div>
                    <div className="font-mono text-[11px] text-on-surface-variant">
                      {row.eventId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.processingStatus || row.status}
                  </td>
                  <td className="px-4 py-3 text-amber-800">
                    {row.corrections.map((item) => item.message).join(" ") || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
