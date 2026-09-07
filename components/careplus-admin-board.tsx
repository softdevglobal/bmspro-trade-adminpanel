"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type {
  CareplusIntegrationRecord,
  CareplusLearningView,
  CareplusOutboxRecord,
  CareplusStaffMappingRecord,
} from "@/lib/integrations/careplus/types";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "connections" | "training" | "delivery";

type StaffRow = {
  uid: string;
  fullName: string | null;
  email: string | null;
  role: string;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function statusBadge(status: string): string {
  if (status === "active" || status === "sent") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (status === "pending" || status === "retry") {
    return "bg-amber-50 text-amber-800 border-amber-200";
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

function learningRows(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of [
    "items",
    "courses",
    "catalogue",
    "learners",
    "activity",
    "data",
    "results",
  ]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  if (record.data && typeof record.data === "object") {
    return learningRows(record.data);
  }
  return [];
}

export function CareplusAdminBoard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("connections");
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [integrations, setIntegrations] = useState<CareplusIntegrationRecord[]>(
    [],
  );
  const [outbox, setOutbox] = useState<CareplusOutboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [businessId, setBusinessId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [mappings, setMappings] = useState<CareplusStaffMappingRecord[]>([]);
  const [staffUid, setStaffUid] = useState("");
  const [careplusStaffId, setCareplusStaffId] = useState("");
  const [staffSaving, setStaffSaving] = useState(false);

  const [learningView, setLearningView] =
    useState<CareplusLearningView>("catalogue");
  const [learningBody, setLearningBody] = useState<unknown>(null);
  const [learningCursor, setLearningCursor] = useState<string | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [learningLoading, setLearningLoading] = useState(false);

  const [processing, setProcessing] = useState(false);

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
      const [tenantsRes, integrationsRes, outboxRes] = await Promise.all([
        fetch("/api/admin/tenants", { headers, cache: "no-store" }),
        fetch("/api/admin/careplus/integrations", {
          headers,
          cache: "no-store",
        }),
        fetch("/api/admin/careplus/outbox", { headers, cache: "no-store" }),
      ]);
      const tenantsData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        tenants?: TenantDetail[];
      }>(tenantsRes);
      const integrationsData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        integrations?: CareplusIntegrationRecord[];
      }>(integrationsRes);
      const outboxData = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        outbox?: CareplusOutboxRecord[];
      }>(outboxRes);
      if (!tenantsRes.ok || !tenantsData.ok) {
        throw new Error(tenantsData.error ?? "Could not load tenants.");
      }
      if (!integrationsRes.ok || !integrationsData.ok) {
        throw new Error(integrationsData.error ?? "Could not load mappings.");
      }
      setTenants(tenantsData.tenants ?? []);
      setIntegrations(integrationsData.integrations ?? []);
      setOutbox(outboxData.outbox ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load CarePlus.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeIntegrations = useMemo(
    () => integrations.filter((row) => row.status === "active"),
    [integrations],
  );

  const tenantName = useCallback(
    (id: string) =>
      tenants.find((tenant) => tenant.id === id)?.businessName || id,
    [tenants],
  );

  async function saveMapping() {
    setSaving(true);
    setFormError(null);
    setFormOk(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/careplus/integrations", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          careplusProviderId: providerId,
        }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        integration?: CareplusIntegrationRecord;
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not save mapping.");
      }
      setFormOk(
        data.integration?.secretConfigured
          ? "Mapping saved. Job completions will queue for CarePlus."
          : "Mapping saved, but no server secret is configured for this business yet.",
      );
      setProviderId("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeMapping(id: string) {
    const headers = await authHeaders();
    const response = await fetch(
      `/api/admin/careplus/integrations/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      },
    );
    const data = await readJsonResponse<{ ok?: boolean; error?: string }>(
      response,
    );
    if (!response.ok || !data.ok) {
      setFormError(data.error ?? "Could not revoke mapping.");
      return;
    }
    await load();
  }

  const loadStaff = useCallback(
    async (id: string) => {
      if (!id) {
        setStaff([]);
        setMappings([]);
        return;
      }
      const headers = await authHeaders();
      const response = await fetch(
        `/api/admin/careplus/integrations/${encodeURIComponent(id)}/staff`,
        { headers, cache: "no-store" },
      );
      const data = await readJsonResponse<{
        ok?: boolean;
        staff?: StaffRow[];
        mappings?: CareplusStaffMappingRecord[];
      }>(response);
      setStaff(data.staff ?? []);
      setMappings(data.mappings ?? []);
    },
    [authHeaders],
  );

  useEffect(() => {
    if (selectedBusinessId) void loadStaff(selectedBusinessId);
  }, [loadStaff, selectedBusinessId]);

  async function saveStaffMapping() {
    if (!selectedBusinessId) return;
    setStaffSaving(true);
    try {
      const headers = await authHeaders();
      const chosen = staff.find((row) => row.uid === staffUid);
      const response = await fetch(
        `/api/admin/careplus/integrations/${encodeURIComponent(selectedBusinessId)}/staff`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            bmsStaffUid: staffUid,
            bmsStaffName: chosen?.fullName ?? null,
            careplusStaffId,
          }),
        },
      );
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(
        response,
      );
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not save staff mapping.");
      }
      setCareplusStaffId("");
      await loadStaff(selectedBusinessId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Staff mapping failed.");
    } finally {
      setStaffSaving(false);
    }
  }

  async function loadLearning(cursor?: string | null) {
    if (!selectedBusinessId) {
      setLearningError("Select a mapped tenant first.");
      return;
    }
    setLearningLoading(true);
    setLearningError(null);
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams({
        businessId: selectedBusinessId,
        view: learningView,
        limit: "25",
      });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(
        `/api/admin/careplus/learning?${params.toString()}`,
        { headers, cache: "no-store" },
      );
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        body?: unknown;
        nextCursor?: string | null;
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Learning request failed.");
      }
      setLearningBody(data.body ?? null);
      setLearningCursor(data.nextCursor ?? null);
    } catch (err) {
      setLearningBody(null);
      setLearningCursor(null);
      setLearningError(
        err instanceof Error ? err.message : "Learning request failed.",
      );
    } finally {
      setLearningLoading(false);
    }
  }

  async function processOutbox() {
    setProcessing(true);
    try {
      const headers = await authHeaders();
      await fetch("/api/admin/careplus/outbox", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: selectedBusinessId || undefined,
        }),
      });
      await load();
    } finally {
      setProcessing(false);
    }
  }

  const rows = learningRows(learningBody);

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
        Super Admin only. This does not copy inspections or invoices to CarePlus.
        Connected tenants send a small <code>job.completed</code> event after a
        job is saved here, and can read staff training metadata.
      </p>

      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 font-body text-[13px] text-on-error-container">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["connections", "Connections"],
            ["training", "Training"],
            ["delivery", "Delivery"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-3.5 py-1.5 font-body text-[13px] ${
              tab === id
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "connections" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_1fr]">
          <section className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm">
            <h2 className="font-headline text-[16px] text-on-surface">
              Map a tenant
            </h2>
            <p className="mt-1 font-body text-[12px] text-on-surface-variant">
              Use the exact BMS business ID already verified in CarePlus. Keep
              the 64-character secret in server env, not here.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block font-body text-[12px] text-on-surface-variant">
                BMS tenant
                <select
                  className={`${INPUT_CLASS} mt-1`}
                  value={businessId}
                  onChange={(event) => setBusinessId(event.target.value)}
                >
                  <option value="">Select tenant</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.businessName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block font-body text-[12px] text-on-surface-variant">
                CarePlus provider ID
                <input
                  className={`${INPUT_CLASS} mt-1`}
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                  placeholder="Verified CarePlus provider ID"
                />
              </label>
              <button
                type="button"
                disabled={saving || !businessId || !providerId}
                onClick={() => void saveMapping()}
                className="w-full rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save mapping"}
              </button>
              {formError ? (
                <p className="font-body text-[12px] text-error">{formError}</p>
              ) : null}
              {formOk ? (
                <p className="font-body text-[12px] text-emerald-700">{formOk}</p>
              ) : null}
            </div>
          </section>

          <section className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-surface-container font-body text-[12px] text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tenant</th>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Secret</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody className="font-body text-[13px] text-on-surface">
                  {integrations.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-on-surface-variant" colSpan={5}>
                        No CarePlus mappings yet.
                      </td>
                    </tr>
                  ) : (
                    integrations.map((row) => (
                      <tr
                        key={row.businessId}
                        className="border-t border-outline-variant/60"
                      >
                        <td className="px-4 py-3">
                          {row.businessName || tenantName(row.businessId)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px]">
                          {row.careplusProviderId}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(row.status)}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.secretConfigured ? "Configured" : "Missing"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.status === "active" ? (
                            <button
                              type="button"
                              onClick={() => void revokeMapping(row.businessId)}
                              className="font-body text-[12px] text-error"
                            >
                              Revoke
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm">
              <h3 className="font-headline text-[15px] text-on-surface">
                Staff mapping
              </h3>
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                IDs are not interchangeable. Map a BMS staff member to a CarePlus
                staff ID only after review.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <select
                  className={INPUT_CLASS}
                  value={selectedBusinessId}
                  onChange={(event) => setSelectedBusinessId(event.target.value)}
                >
                  <option value="">Mapped tenant</option>
                  {activeIntegrations.map((row) => (
                    <option key={row.businessId} value={row.businessId}>
                      {row.businessName || tenantName(row.businessId)}
                    </option>
                  ))}
                </select>
                <select
                  className={INPUT_CLASS}
                  value={staffUid}
                  onChange={(event) => setStaffUid(event.target.value)}
                >
                  <option value="">BMS staff</option>
                  {staff.map((row) => (
                    <option key={row.uid} value={row.uid}>
                      {row.fullName || row.email || row.uid}
                    </option>
                  ))}
                </select>
                <input
                  className={INPUT_CLASS}
                  value={careplusStaffId}
                  onChange={(event) => setCareplusStaffId(event.target.value)}
                  placeholder="CarePlus staff ID"
                />
              </div>
              <button
                type="button"
                disabled={staffSaving || !selectedBusinessId || !staffUid || !careplusStaffId}
                onClick={() => void saveStaffMapping()}
                className="mt-3 rounded-lg border border-outline-variant px-4 py-2 font-body text-[13px] disabled:opacity-50"
              >
                {staffSaving ? "Saving…" : "Save staff link"}
              </button>
              {mappings.length > 0 ? (
                <ul className="mt-4 space-y-2 font-body text-[13px]">
                  {mappings.map((row) => (
                    <li key={row.id} className="text-on-surface-variant">
                      {row.bmsStaffName || row.bmsStaffUid} → {row.careplusStaffId}{" "}
                      ({row.status})
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "training" ? (
        <section className="space-y-4 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1 font-body text-[12px] text-on-surface-variant">
              Mapped tenant
              <select
                className={`${INPUT_CLASS} mt-1`}
                value={selectedBusinessId}
                onChange={(event) => setSelectedBusinessId(event.target.value)}
              >
                <option value="">Select tenant</option>
                {activeIntegrations.map((row) => (
                  <option key={row.businessId} value={row.businessId}>
                    {row.businessName || tenantName(row.businessId)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              {(["catalogue", "learners", "activity"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setLearningView(view)}
                  className={`rounded-full border px-3 py-1.5 font-body text-[12px] capitalize ${
                    learningView === view
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant"
                  }`}
                >
                  {view}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={learningLoading}
              onClick={() => void loadLearning()}
              className="rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary disabled:opacity-50"
            >
              {learningLoading ? "Loading…" : "Read CarePlus"}
            </button>
          </div>
          {learningError ? (
            <p className="font-body text-[13px] text-error">{learningError}</p>
          ) : null}
          {rows.length > 0 ? (
            <div className="overflow-auto rounded-xl border border-outline-variant/60">
              <table className="min-w-full text-left font-body text-[13px]">
                <thead className="bg-surface-container text-[12px] text-on-surface-variant">
                  <tr>
                    {Object.keys(rows[0] as object)
                      .slice(0, 6)
                      .map((key) => (
                        <th key={key} className="px-3 py-2 font-medium">
                          {key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const record =
                      row && typeof row === "object"
                        ? (row as Record<string, unknown>)
                        : {};
                    return (
                      <tr
                        key={index}
                        className="border-t border-outline-variant/50"
                      >
                        {Object.keys(rows[0] as object)
                          .slice(0, 6)
                          .map((key) => (
                            <td key={key} className="px-3 py-2">
                              {typeof record[key] === "string" ||
                              typeof record[key] === "number"
                                ? String(record[key])
                                : "—"}
                            </td>
                          ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : learningBody ? (
            <pre className="max-h-[420px] overflow-auto rounded-xl bg-stone-950 p-4 font-mono text-[12px] text-stone-100">
              {JSON.stringify(learningBody, null, 2)}
            </pre>
          ) : (
            <p className="font-body text-[13px] text-on-surface-variant">
              Choose a mapped tenant and read catalogue, learners, or activity.
            </p>
          )}
          {learningCursor ? (
            <button
              type="button"
              onClick={() => void loadLearning(learningCursor)}
              className="font-body text-[13px] text-primary"
            >
              Load next page
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === "delivery" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-body text-[13px] text-on-surface-variant">
              Completed jobs are queued here, then sent by cron. Processing does
              not change the job in Firestore.
            </p>
            <button
              type="button"
              disabled={processing}
              onClick={() => void processOutbox()}
              className="rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary disabled:opacity-50"
            >
              {processing ? "Sending…" : "Process outbox now"}
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-surface-container font-body text-[12px] text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="font-body text-[13px]">
                {outbox.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-on-surface-variant" colSpan={5}>
                      No queued CarePlus events.
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
                      <td className="px-4 py-3">{tenantName(row.businessId)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(row.status)}`}
                        >
                          {row.status}
                          {row.lastErrorCode ? ` · ${row.lastErrorCode}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.attempts}</td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {formatWhen(row.sentAt ?? row.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
