"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { summarizeCareplusOutbox } from "@/lib/integrations/careplus/outbox-summary";
import type {
  CareplusOperationsCustomer,
  CareplusOutboxRecord,
} from "@/lib/integrations/careplus/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type CaptureType =
  | "incident.captured"
  | "complaint.captured"
  | "risk.captured"
  | "action.captured"
  | "evidence.attached"
  | "staff.credential.submitted";

type StaffRow = {
  uid: string;
  fullName: string | null;
  email: string | null;
  role: string;
};

export function CareplusOperationsBoard() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [outbox, setOutbox] = useState<CareplusOutboxRecord[]>([]);
  const [customers, setCustomers] = useState<CareplusOperationsCustomer[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [eventType, setEventType] = useState<CaptureType>("incident.captured");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [immediateAction, setImmediateAction] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [awarenessAt, setAwarenessAt] = useState("");
  const [location, setLocation] = useState("");
  const [reporterNote, setReporterNote] = useState("");
  const [escalationMade, setEscalationMade] = useState("");
  const [channel, setChannel] = useState("in_person");
  const [requestedOutcome, setRequestedOutcome] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [due, setDue] = useState("");
  const [likelihood, setLikelihood] = useState("medium");
  const [consequence, setConsequence] = useState("medium");
  const [existingControls, setExistingControls] = useState("");
  const [siteOrAsset, setSiteOrAsset] = useState("");
  const [proposedOwner, setProposedOwner] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [treatment, setTreatment] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sourceRecordId, setSourceRecordId] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [byteSize, setByteSize] = useState(0);
  const [filename, setFilename] = useState("");
  const [issuer, setIssuer] = useState("");
  const [reference, setReference] = useState("");
  const [expiry, setExpiry] = useState("");
  const [credentialType, setCredentialType] = useState("Training");
  const [claimedStatus, setClaimedStatus] = useState("pending");

  const authHeaders = useCallback(async () => {
    if (!user) throw new Error("Please sign in again.");
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [user]);

  const counts = useMemo(() => {
    const summary = summarizeCareplusOutbox(outbox);
    return {
      pending: summary.pending + summary.awaiting,
      applied: summary.applied,
      rejected: summary.rejected,
    };
  }, [outbox]);

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
        paused?: boolean;
        customers?: CareplusOperationsCustomer[];
        staff?: StaffRow[];
        outbox?: CareplusOutboxRecord[];
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not load CarePlus records.");
      }
      const nextCustomers = data.customers ?? [];
      setConnected(Boolean(data.connected));
      setPaused(Boolean(data.paused));
      setCustomers(nextCustomers);
      setStaff(data.staff ?? []);
      setOutbox(data.outbox ?? []);
      setCustomerId((current) => {
        if (current && nextCustomers.some((row) => row.uid === current)) {
          return current;
        }
        const mapped = nextCustomers.filter((row) => row.mapped);
        if (mapped.length === 1) return mapped[0].uid;
        if (nextCustomers.length === 1) return nextCustomers[0].uid;
        return current && nextCustomers.length === 0 ? current : "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load CarePlus.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadEvidence(file: File) {
    setUploading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/uploads/careplus-evidence", {
        method: "POST",
        headers,
        body,
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        fileUrl?: string;
        sha256?: string;
        byteSize?: number;
        filename?: string;
      }>(response);
      if (!response.ok || !data.ok || !data.fileUrl || !data.sha256) {
        throw new Error(data.error ?? "Could not upload the file.");
      }
      setFileUrl(data.fileUrl);
      setSha256(data.sha256);
      setByteSize(data.byteSize ?? file.size);
      setFilename(data.filename ?? file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  }

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
          staffId,
          severity,
          immediateAction,
          anonymous,
          awarenessAt,
          location,
          reporterNote,
          escalationMade,
          channel,
          requestedOutcome,
          actionTaken,
          due,
          likelihood,
          consequence,
          existingControls,
          siteOrAsset,
          proposedOwner,
          reviewDate,
          treatment,
          sourceType,
          sourceRecordId,
          fileUrl,
          sha256,
          byteSize,
          filename,
          issuer,
          reference,
          expiry,
          credentialType,
          claimedStatus,
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
      setAnonymous(false);
      setAwarenessAt("");
      setLocation("");
      setReporterNote("");
      setEscalationMade("");
      setRequestedOutcome("");
      setActionTaken("");
      setDue("");
      setExistingControls("");
      setSiteOrAsset("");
      setProposedOwner("");
      setReviewDate("");
      setTreatment("");
      setSourceType("");
      setSourceRecordId("");
      setFileUrl("");
      setSha256("");
      setByteSize(0);
      setFilename("");
      setIssuer("");
      setReference("");
      setExpiry("");
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
        Capture daily incidents, complaints, risks, credentials and follow-up
        actions here. CarePlus checks participant and staff mappings, then holds
        assessment, reporting deadlines and audit history. Training stays in
        CarePlus.
      </p>
      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 font-body text-[13px] text-on-error-container">
          {error}
        </div>
      ) : null}
      {paused ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
          CarePlus mapping is revoked. Queued records stay paused until Super
          Admin restores the connection. They are not retried as transport
          failures.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Pending / waiting", counts.pending],
          ["Applied / in review", counts.applied],
          ["Rejected / correction", counts.rejected],
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
                  setEventType(event.target.value as CaptureType)
                }
              >
                <option value="incident.captured">Incident</option>
                <option value="complaint.captured">Complaint or feedback</option>
                <option value="risk.captured">Risk</option>
                <option value="action.captured">Follow-up action</option>
                <option value="evidence.attached">Evidence file</option>
                <option value="staff.credential.submitted">Staff credential</option>
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
              <>
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
                <label className="font-body text-[12px] text-on-surface-variant">
                  Location
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Awareness time (ISO, optional)
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={awarenessAt}
                    onChange={(event) => setAwarenessAt(event.target.value)}
                    placeholder="2026-09-11T04:00:00.000Z"
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Reporter or witness note
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={reporterNote}
                    onChange={(event) => setReporterNote(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {eventType === "risk.captured" ? (
              <>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Likelihood
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={likelihood}
                    onChange={(event) => setLikelihood(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Consequence
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={consequence}
                    onChange={(event) => setConsequence(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Site or asset
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={siteOrAsset}
                    onChange={(event) => setSiteOrAsset(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Proposed owner
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={proposedOwner}
                    onChange={(event) => setProposedOwner(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Review date
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    type="date"
                    value={reviewDate}
                    onChange={(event) => setReviewDate(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Immediate controls
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={existingControls}
                    onChange={(event) => setExistingControls(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <label className="font-body text-[12px] text-on-surface-variant">
              Customer
              <select
                className={`${INPUT_CLASS} mt-1`}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">
                  {customers.length === 0
                    ? "No BMS customers found"
                    : eventType === "complaint.captured"
                      ? "None — anonymous or unmapped"
                      : "None — person is not mapped"}
                </option>
                {customers.map((row) => (
                  <option key={row.uid} value={row.uid}>
                    {row.fullName}
                    {row.email ? ` (${row.email})` : ""}
                    {row.mapped ? "" : " — not mapped"}
                  </option>
                ))}
              </select>
            </label>
            {eventType === "staff.credential.submitted" ||
            eventType === "action.captured" ? (
              <label className="font-body text-[12px] text-on-surface-variant">
                Staff
                <select
                  className={`${INPUT_CLASS} mt-1`}
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Current user</option>
                  {staff.map((row) => (
                    <option key={row.uid} value={row.uid}>
                      {row.fullName || row.email || row.uid}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {eventType === "complaint.captured" ? (
              <>
                <label className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant md:col-span-2">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(event) => setAnonymous(event.target.checked)}
                  />
                  Anonymous or unnamed complainant
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Channel
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={channel}
                    onChange={(event) => setChannel(event.target.value)}
                  >
                    <option value="in_person">In person</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="written">Written</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Requested outcome
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={requestedOutcome}
                    onChange={(event) => setRequestedOutcome(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant md:col-span-2">
                  Action already taken
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={actionTaken}
                    onChange={(event) => setActionTaken(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Follow-up due
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    type="date"
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
              {eventType === "risk.captured"
                ? "Hazard or situation"
                : eventType === "staff.credential.submitted"
                  ? "Notes"
                  : "What happened"}
              <textarea
                className={`${INPUT_CLASS} mt-1 min-h-[96px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {eventType === "incident.captured" ? (
              <>
                <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
                  Immediate action taken
                  <textarea
                    className={`${INPUT_CLASS} mt-1 min-h-[72px]`}
                    value={immediateAction}
                    onChange={(event) => setImmediateAction(event.target.value)}
                  />
                </label>
                <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
                  Escalation already made
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={escalationMade}
                    onChange={(event) => setEscalationMade(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {eventType === "risk.captured" ? (
              <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
                Suggested treatment
                <textarea
                  className={`${INPUT_CLASS} mt-1 min-h-[72px]`}
                  value={treatment}
                  onChange={(event) => setTreatment(event.target.value)}
                />
              </label>
            ) : null}
            {eventType === "action.captured" ? (
              <>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Source type
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value)}
                  >
                    <option value="">None</option>
                    <option value="risk">Risk</option>
                    <option value="incident">Incident</option>
                    <option value="complaint">Complaint</option>
                  </select>
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Source record ID
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={sourceRecordId}
                    onChange={(event) => setSourceRecordId(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Due date
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    type="date"
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {eventType === "staff.credential.submitted" ? (
              <>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Credential type
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={credentialType}
                    onChange={(event) => setCredentialType(event.target.value)}
                  >
                    <option value="Training">Training</option>
                    <option value="Worker screening">Worker screening</option>
                    <option value="Qualification">Qualification</option>
                    <option value="Trade licence">Trade licence</option>
                  </select>
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Issuer
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Reference
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  Expiry
                  <input
                    className={`${INPUT_CLASS} mt-1`}
                    type="date"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </label>
                <label className="font-body text-[12px] text-on-surface-variant">
                  BMS claimed status
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={claimedStatus}
                    onChange={(event) => setClaimedStatus(event.target.value)}
                  >
                    <option value="pending">Pending</option>
                    <option value="current">Current</option>
                    <option value="expired">Expired</option>
                  </select>
                </label>
              </>
            ) : null}
            {eventType === "evidence.attached" ? (
              <label className="md:col-span-2 font-body text-[12px] text-on-surface-variant">
                Evidence file
                <input
                  className={`${INPUT_CLASS} mt-1`}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadEvidence(file);
                  }}
                />
                <span className="mt-1 block text-[12px]">
                  {uploading
                    ? "Uploading…"
                    : filename
                      ? `${filename} · ${byteSize} bytes`
                      : "PDF or image up to 3 MB. A URL alone is not accepted."}
                </span>
              </label>
            ) : null}
          </div>
          <button
            type="button"
            disabled={saving || uploading}
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
