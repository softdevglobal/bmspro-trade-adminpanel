"use client";

import {
  SCHEDULE_SELECT_CHEVRON,
  SCHEDULE_SELECT_CLASS,
} from "@/components/calendar-visit-time-range";
import { todayIso } from "@/components/booking-slot-date-picker";
import { MonthCalendarField } from "@/components/month-calendar-field";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { summarizeCareplusOutbox } from "@/lib/integrations/careplus/outbox-summary";
import type {
  CareplusOperationsCustomer,
  CareplusOutboxRecord,
} from "@/lib/integrations/careplus/types";
import { formatClockTime } from "@/lib/inspection/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

function deliveryStatusLabel(row: CareplusOutboxRecord): string {
  if (row.processingStatus === "pending_mapping") return "pending_mapping";
  if (row.processingStatus === "pending_review") return "pending_review";
  if (row.processingStatus === "correction_required") {
    return "correction_required";
  }
  if (row.processingStatus === "rejected") return "rejected";
  if (row.processingStatus === "applied") return "applied";
  if (
    row.careplusRecordId ||
    row.processingStatus === "processed"
  ) {
    return row.processingStatus || "applied";
  }
  if (row.status === "retry") return "Confirming with CarePlus";
  if (row.status === "awaiting_receipt") return "Sent, confirming";
  return row.processingStatus || row.status;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

const SELECT_CLASS = SCHEDULE_SELECT_CLASS;

const CAPTURE_TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const options: { value: string; label: string }[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const label = formatClockTime(value);
    if (label) options.push({ value, label });
  }
  return options;
})();

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={LABEL_CLASS}>{children}</span>;
}

function CaptureTimeSelect({
  value,
  onChange,
  label,
  optional = false,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  optional?: boolean;
  "aria-label"?: string;
}) {
  return (
    <label className="block space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <select
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT_CLASS}
        style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
      >
        {optional ? <option value="">Not set</option> : null}
        {CAPTURE_TIME_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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

function toAwarenessIso(date: string, time: string): string {
  if (!date) return "";
  const clock = time || "12:00";
  const parsed = new Date(`${date}T${clock}:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [eventType, setEventType] = useState<CaptureType>("incident.captured");
  const [stableRecordId, setStableRecordId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => todayIso());
  const [customerId, setCustomerId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [immediateAction, setImmediateAction] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [safetyOrHarm, setSafetyOrHarm] = useState(false);
  const [openIncidentPrompt, setOpenIncidentPrompt] = useState(false);
  const [awarenessDate, setAwarenessDate] = useState("");
  const [awarenessTime, setAwarenessTime] = useState("");
  const [incidentTime, setIncidentTime] = useState("");
  const minCalendarDate = useMemo(() => todayIso(), []);
  const [incidentType, setIncidentType] = useState("");
  const [location, setLocation] = useState("");
  const [reporterNote, setReporterNote] = useState("");
  const [witnesses, setWitnesses] = useState("");
  const [injuryDetails, setInjuryDetails] = useState("");
  const [escalationMade, setEscalationMade] = useState("");
  const [notifiedParties, setNotifiedParties] = useState<string[]>([]);
  const [involvedStaffIds, setInvolvedStaffIds] = useState<string[]>([]);
  const [channel, setChannel] = useState("in_person");
  const [category, setCategory] = useState("");
  const [requestedOutcome, setRequestedOutcome] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [due, setDue] = useState("");
  const [complaintRiskLevel, setComplaintRiskLevel] = useState("");
  const [riskNotes, setRiskNotes] = useState("");
  const [complainantName, setComplainantName] = useState("");
  const [complainantRelationship, setComplainantRelationship] = useState("");
  const [complainantContact, setComplainantContact] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [representativeContact, setRepresentativeContact] = useState("");
  const [supportOffered, setSupportOffered] = useState("");
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

  const isIncident = eventType === "incident.captured";
  const isComplaint = eventType === "complaint.captured";
  const isRisk = eventType === "risk.captured";

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

  function resetFormFields() {
    setTitle("");
    setDescription("");
    setDate(todayIso());
    setImmediateAction("");
    setAnonymous(false);
    setSafetyOrHarm(false);
    setAwarenessDate("");
    setAwarenessTime("");
    setIncidentTime("");
    setIncidentType("");
    setLocation("");
    setReporterNote("");
    setWitnesses("");
    setInjuryDetails("");
    setEscalationMade("");
    setNotifiedParties([]);
    setInvolvedStaffIds([]);
    setCategory("");
    setRequestedOutcome("");
    setActionTaken("");
    setDue("");
    setComplaintRiskLevel("");
    setRiskNotes("");
    setComplainantName("");
    setComplainantRelationship("");
    setComplainantContact("");
    setRepresentativeName("");
    setRepresentativeContact("");
    setSupportOffered("");
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
    setStableRecordId(crypto.randomUUID());
  }

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
    setOpenIncidentPrompt(false);
    try {
      if (isComplaint && anonymous) {
        setCustomerId("");
      }
      const headers = await authHeaders();
      const response = await fetch("/api/careplus/records", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          recordId: stableRecordId,
          title,
          description,
          date,
          customerId: isComplaint && anonymous ? "" : customerId,
          staffId,
          severity,
          immediateAction,
          anonymous,
          safetyOrHarm,
          awarenessAt: toAwarenessIso(awarenessDate, awarenessTime),
          incidentTime,
          incidentType,
          location,
          reporterNote,
          witnesses,
          injuryDetails,
          escalationMade,
          notifiedParties,
          involvedStaffIds,
          channel,
          category,
          requestedOutcome,
          actionTaken,
          due,
          safetyConcern: safetyOrHarm,
          riskLevel: isComplaint ? complaintRiskLevel : undefined,
          riskNotes,
          complainantName,
          complainantRelationship,
          complainantContact,
          representativeName,
          representativeContact,
          supportOffered,
          likelihood,
          consequence,
          existingControls,
          siteOrAsset,
          proposedOwner,
          reviewOwnerId: proposedOwner,
          reviewDate,
          treatment,
          status: isRisk ? "open" : undefined,
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
      const data = await readJsonResponse<{
        ok?: boolean;
        error?: string;
        queued?: string;
        recordId?: string;
        deliveryError?: string | null;
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not send the record.");
      }
      setOk(
        data.queued === "failed"
          ? data.deliveryError
            ? `Could not deliver to CarePlus: ${data.deliveryError}`
            : "Could not deliver to CarePlus yet. Use Retry in Delivery below when the connection is ready."
          : data.queued === "retry"
            ? data.deliveryError
              ? `CarePlus did not confirm yet (${data.deliveryError}). Trade will retry automatically, or use Retry below.`
              : "CarePlus did not confirm yet. Trade will retry automatically, or use Retry below."
            : data.queued === "exists"
              ? "This record was already sent (identical retry)."
              : data.queued === "queued"
                ? "Sent to CarePlus. Delivery is still confirming."
                : "Sent to CarePlus. Check delivery status below.",
      );
      if (isComplaint && safetyOrHarm) {
        setOpenIncidentPrompt(true);
      }
      resetFormFields();
      if (isComplaint && safetyOrHarm) {
        setEventType("incident.captured");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the record.");
    } finally {
      setSaving(false);
    }
  }

  async function retryRecord(eventId: string) {
    setRetryingId(eventId);
    setError(null);
    setOk(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/careplus/records", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", eventId }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(
        response,
      );
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not send the record again.");
      }
      setOk("Sent to CarePlus again. Check delivery status below.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the record again.",
      );
    } finally {
      setRetryingId(null);
    }
  }

  async function deleteRecord(eventId: string) {
    if (
      !window.confirm(
        "Remove this delivery from Trade? The record already in CarePlus is not deleted.",
      )
    ) {
      return;
    }
    setDeletingId(eventId);
    setError(null);
    setOk(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(
        `/api/careplus/records?eventId=${encodeURIComponent(eventId)}`,
        { method: "DELETE", headers },
      );
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(
        response,
      );
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not delete the record.");
      }
      setOutbox((current) => current.filter((row) => row.eventId !== eventId));
      setOk("Record removed from this list.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the record.");
    } finally {
      setDeletingId(null);
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
      <section className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-4 shadow-sm sm:p-5">
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: "edit_note",
              title: "Capture it here",
              body: "Record an incident, complaint or risk as it happened.",
            },
            {
              icon: "send",
              title: "Trade sends it to CarePlus",
              body: "Track delivery below and retry if anything fails.",
            },
            {
              icon: "verified_user",
              title: "CarePlus takes it from there",
              body: "Assessment, follow-up actions and closure happen in CarePlus.",
            },
          ].map((step, index) => (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-xl bg-surface-container-low px-3.5 py-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[20px]">
                  {step.icon}
                </span>
              </span>
              <div className="min-w-0">
                <p className="font-body text-[13px] font-semibold text-on-surface">
                  <span className="text-on-surface-variant">{index + 1}.</span>{" "}
                  {step.title}
                </p>
                <p className="mt-0.5 font-body text-[12px] leading-snug text-on-surface-variant">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-outline-variant/50 pt-3">
          <p className="font-body text-[12px] text-on-surface-variant">
            People not yet linked in CarePlus stay pending until they are
            matched.
          </p>
          <div className="flex flex-wrap items-center gap-2 font-body text-[12px]">
            <span className="text-on-surface-variant">Also from</span>
            {[
              ["Jobs", "/dashboard/jobs"],
              ["Customers", "/dashboard/customers"],
              ["Staff", "/dashboard/team/management"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="rounded-full border border-outline-variant px-2.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/5"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>
      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 font-body text-[13px] text-on-error-container">
          {error}
        </div>
      ) : null}
      {paused ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
          CarePlus mapping is revoked. You can still capture the record and
          retry delivery below once the connection is restored.
        </p>
      ) : null}
      {!connected && !paused ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
          CarePlus is not mapped for this business yet. You can still capture
          the record and retry delivery below once mapping is active.
        </p>
      ) : null}
      {openIncidentPrompt ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-900">
          Safety or harm was flagged on the complaint. The form is set to
          Incident — send an incident record as well if one is required.
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
      <section className="rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="font-headline text-[16px] text-on-surface">
            Send a record to CarePlus
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <FieldLabel>Type</FieldLabel>
              <select
                className={SELECT_CLASS}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                value={eventType}
                onChange={(event) => {
                  setEventType(event.target.value as CaptureType);
                  setStableRecordId(crypto.randomUUID());
                }}
              >
                <option value="incident.captured">Incident</option>
                <option value="complaint.captured">Complaint or feedback</option>
                <option value="risk.captured">Risk</option>
                <option value="action.captured">Follow-up action</option>
                <option value="evidence.attached">Evidence file</option>
                <option value="staff.credential.submitted">Staff credential</option>
              </select>
            </label>
            <label className="block space-y-1">
              <FieldLabel>
                {isIncident
                  ? "Incident title"
                  : isComplaint
                    ? "Subject"
                    : isRisk
                      ? "Risk title"
                      : "Title"}
              </FieldLabel>
              <input
                className={INPUT_CLASS}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {isIncident || isComplaint ? (
              <MonthCalendarField
                size="comfortable"
                allowPast
                label={
                  isIncident
                    ? "Date it happened"
                    : isComplaint
                      ? "Date received"
                      : "Date"
                }
                selectedIso={date}
                minDate={minCalendarDate}
                onSelect={setDate}
              />
            ) : null}
            {isIncident ? (
              <>
                <CaptureTimeSelect
                  optional
                  label="Time (approximate is fine)"
                  value={incidentTime}
                  onChange={setIncidentTime}
                />
                <label className="block space-y-1">
                  <FieldLabel>Type of incident</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={incidentType}
                    onChange={(event) => setIncidentType(event.target.value)}
                  >
                    <option value="">Select type</option>
                    <option value="Injury or illness">Injury or illness</option>
                    <option value="Fall">Fall</option>
                    <option value="Medication">Medication</option>
                    <option value="Behaviour of concern">Behaviour of concern</option>
                    <option value="Abuse or neglect allegation">
                      Abuse or neglect allegation
                    </option>
                    <option value="Restrictive practice">Restrictive practice</option>
                    <option value="Missing person">Missing person</option>
                    <option value="Property damage or loss">
                      Property damage or loss
                    </option>
                    <option value="Near miss">Near miss</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Severity</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="block space-y-1 md:col-span-2">
                  <FieldLabel>Where did it happen?</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Participant’s home, vehicle, community venue…"
                  />
                </label>
                <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                  <MonthCalendarField
                    size="comfortable"
                    allowPast
                    label="Aware date (optional)"
                    placeholder="Select date"
                    selectedIso={awarenessDate}
                    minDate={minCalendarDate}
                    onSelect={setAwarenessDate}
                  />
                  <CaptureTimeSelect
                    optional
                    label="Aware time (optional)"
                    value={awarenessTime}
                    onChange={setAwarenessTime}
                  />
                </div>
                <p className="md:col-span-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
                  Capture what happened here. CarePlus owns reportability,
                  investigation and Commission notification — Trade does not
                  close those.
                </p>
              </>
            ) : null}
            {isRisk ? (
              <>
                <label className="block space-y-1">
                  <FieldLabel>Likelihood</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={likelihood}
                    onChange={(event) => setLikelihood(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Consequence</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={consequence}
                    onChange={(event) => setConsequence(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Site or asset</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={siteOrAsset}
                    onChange={(event) => setSiteOrAsset(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Review owner</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={proposedOwner}
                    onChange={(event) => setProposedOwner(event.target.value)}
                  >
                    <option value="">Current user / unset</option>
                    {staff.map((row) => (
                      <option key={row.uid} value={row.uid}>
                        {row.fullName || row.email || row.uid}
                      </option>
                    ))}
                  </select>
                </label>
                <MonthCalendarField
                  size="comfortable"
                  allowPast
                  label="Review date"
                  placeholder="Select date"
                  selectedIso={reviewDate}
                  minDate={minCalendarDate}
                  onSelect={setReviewDate}
                />
                <label className="block space-y-1 md:col-span-2">
                  <FieldLabel>Existing controls</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={existingControls}
                    onChange={(event) => setExistingControls(event.target.value)}
                  />
                </label>
                <p className="md:col-span-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
                  CarePlus opens the risk as <span className="font-semibold">open</span>{" "}
                  and creates a follow-up action. Provider assessment, residual
                  risk and closure happen in CarePlus — not in Trade.
                </p>
              </>
            ) : null}
            <label className="block space-y-1">
              <FieldLabel>
                {isIncident || isComplaint || isRisk
                  ? "Participant (optional)"
                  : "Customer"}
              </FieldLabel>
              <select
                className={SELECT_CLASS}
                style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                value={customerId}
                disabled={isComplaint && anonymous}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">
                  {customers.length === 0
                    ? "No BMS customers found"
                    : isComplaint
                      ? "None — anonymous or unmapped"
                      : isIncident || isRisk
                        ? "Leave blank if the person is not linked yet"
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
            {isIncident ? (
              <fieldset className="md:col-span-2 rounded-xl border border-outline-variant/60 p-3">
                <legend className="px-1 font-body text-[12px] font-semibold text-on-surface">
                  Staff involved or present
                </legend>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {staff.length === 0 ? (
                    <p className="font-body text-[12px] text-on-surface-variant">
                      No staff loaded.
                    </p>
                  ) : (
                    staff.map((row) => {
                      const checked = involvedStaffIds.includes(row.uid);
                      return (
                        <label
                          key={row.uid}
                          className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setInvolvedStaffIds((current) =>
                                event.target.checked
                                  ? [...current, row.uid]
                                  : current.filter((id) => id !== row.uid),
                              );
                            }}
                          />
                          {row.fullName || row.email || row.uid}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>
            ) : null}
            {eventType === "staff.credential.submitted" ||
            eventType === "action.captured" ||
            isComplaint ? (
              <label className="block space-y-1">
                <FieldLabel>{isComplaint ? "Owner (staff)" : "Staff"}</FieldLabel>
                <select
                  className={SELECT_CLASS}
                  style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
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
            {isComplaint ? (
              <>
                <label className="block space-y-1">
                  <FieldLabel>Category</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    <option value="">Select category</option>
                    <option value="Service delivery">Service delivery</option>
                    <option value="Staff conduct">Staff conduct</option>
                    <option value="Communication">Communication</option>
                    <option value="Safety">Safety</option>
                    <option value="Billing or fees">Billing or fees</option>
                    <option value="Privacy">Privacy</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant md:col-span-2">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(event) => {
                      setAnonymous(event.target.checked);
                      if (event.target.checked) {
                        setCustomerId("");
                        setComplainantName("");
                        setComplainantRelationship("");
                        setComplainantContact("");
                      }
                    }}
                  />
                  Anonymous or unnamed complainant
                </label>
                <label className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant md:col-span-2">
                  <input
                    type="checkbox"
                    checked={safetyOrHarm}
                    onChange={(event) => setSafetyOrHarm(event.target.checked)}
                  />
                  Someone may be unsafe or harmed (also open an Incident if needed)
                </label>
                {safetyOrHarm ? (
                  <>
                    <label className="block space-y-1">
                      <FieldLabel>Risk level</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                        value={complaintRiskLevel}
                        onChange={(event) =>
                          setComplaintRiskLevel(event.target.value)
                        }
                      >
                        <option value="">Select</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="md:col-span-2 block space-y-1">
                      <FieldLabel>Risk assessment notes</FieldLabel>
                      <textarea
                        className={`${INPUT_CLASS} min-h-[72px]`}
                        value={riskNotes}
                        onChange={(event) => setRiskNotes(event.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                <label className="block space-y-1">
                  <FieldLabel>How it was received</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={channel}
                    onChange={(event) => setChannel(event.target.value)}
                  >
                    <option value="in_person">In person</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="written">Letter or form</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                {!anonymous ? (
                  <>
                    <label className="block space-y-1">
                  <FieldLabel>Person making the complaint</FieldLabel>
                  <input
                        className={INPUT_CLASS}
                        value={complainantName}
                        onChange={(event) =>
                          setComplainantName(event.target.value)
                        }
                      />
                    </label>
                    <label className="block space-y-1">
                  <FieldLabel>Relationship to the participant</FieldLabel>
                  <select
                        className={SELECT_CLASS}
                        style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                        value={complainantRelationship}
                        onChange={(event) =>
                          setComplainantRelationship(event.target.value)
                        }
                      >
                        <option value="">Select</option>
                        <option value="Participant">Participant</option>
                        <option value="Family member">Family member</option>
                        <option value="Carer or guardian">Carer or guardian</option>
                        <option value="Advocate">Advocate</option>
                        <option value="Staff member">Staff member</option>
                        <option value="Other">Other</option>
                      </select>
                    </label>
                    <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Preferred contact details</FieldLabel>
                  <input
                        className={INPUT_CLASS}
                        value={complainantContact}
                        onChange={(event) =>
                          setComplainantContact(event.target.value)
                        }
                        placeholder="Phone, email or how they want to be contacted"
                      />
                    </label>
                  </>
                ) : null}
                <label className="block space-y-1">
                  <FieldLabel>Representative or advocate</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={representativeName}
                    onChange={(event) => setRepresentativeName(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Representative contact details</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={representativeContact}
                    onChange={(event) =>
                      setRepresentativeContact(event.target.value)
                    }
                  />
                </label>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Communication or advocacy support offered</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={supportOffered}
                    onChange={(event) => setSupportOffered(event.target.value)}
                    placeholder="Interpreter, Easy Read, independent advocate…"
                  />
                </label>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>What would they like to happen?</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={requestedOutcome}
                    onChange={(event) => setRequestedOutcome(event.target.value)}
                  />
                </label>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Action already taken</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={actionTaken}
                    onChange={(event) => setActionTaken(event.target.value)}
                  />
                </label>
                <MonthCalendarField
                  size="comfortable"
                  allowPast
                  label="Response due"
                  placeholder="Select date"
                  selectedIso={due}
                  minDate={minCalendarDate}
                  onSelect={setDue}
                />
                <p className="md:col-span-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
                  CarePlus owns acknowledgement, investigation, resolution and
                  Commission options. Trade only captures the complaint.
                </p>
              </>
            ) : null}
            <label className="md:col-span-2 block space-y-1">
              <FieldLabel>
                {isRisk
                  ? "Hazard or situation"
                  : isIncident
                    ? "What happened?"
                    : isComplaint
                      ? "Feedback or concern"
                      : eventType === "staff.credential.submitted"
                        ? "Notes"
                        : "What happened"}
              </FieldLabel>
              <textarea
                className={`${INPUT_CLASS} min-h-[96px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={
                  isIncident
                    ? "Describe events in order. Separate allegations from confirmed facts."
                    : isComplaint
                      ? "Use the person’s own words where possible."
                      : undefined
                }
              />
            </label>
            {isIncident ? (
              <>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Witnesses and their contact details</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={witnesses}
                    onChange={(event) => {
                      setWitnesses(event.target.value);
                      setReporterNote(event.target.value);
                    }}
                  />
                </label>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Injuries or harm</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={injuryDetails}
                    onChange={(event) => setInjuryDetails(event.target.value)}
                    placeholder='Describe any injury and treatment. Write "none observed" if there was none.'
                  />
                </label>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Immediate action taken</FieldLabel>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px]`}
                    value={immediateAction}
                    onChange={(event) => setImmediateAction(event.target.value)}
                    placeholder="How was everyone made safe? Include first aid and support given."
                  />
                </label>
                <fieldset className="md:col-span-2 rounded-xl border border-outline-variant/60 p-3">
                  <legend className="px-1 font-body text-[12px] font-semibold text-on-surface">
                    Who has been told so far?
                  </legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {[
                      "Police",
                      "Ambulance or emergency services",
                      "Family, guardian or nominee",
                      "Doctor or health service",
                      "Support coordinator",
                      "Other authority",
                    ].map((party) => {
                      const checked = notifiedParties.includes(party);
                      return (
                        <label
                          key={party}
                          className="flex items-center gap-2 font-body text-[12px] text-on-surface-variant"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setNotifiedParties((current) =>
                                event.target.checked
                                  ? [...current, party]
                                  : current.filter((item) => item !== party),
                              );
                            }}
                          />
                          {party}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Escalation already made</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={escalationMade}
                    onChange={(event) => setEscalationMade(event.target.value)}
                    placeholder="For example supervisor notified, 000 called"
                  />
                </label>
              </>
            ) : null}
            {isRisk ? (
              <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Suggested treatment</FieldLabel>
                  <textarea
                  className={`${INPUT_CLASS} min-h-[72px]`}
                  value={treatment}
                  onChange={(event) => setTreatment(event.target.value)}
                />
              </label>
            ) : null}
            {eventType === "action.captured" ? (
              <>
                <label className="block space-y-1">
                  <FieldLabel>Source type</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value)}
                  >
                    <option value="">None</option>
                    <option value="risk">Risk</option>
                    <option value="incident">Incident</option>
                    <option value="complaint">Complaint</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Source record ID</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={sourceRecordId}
                    onChange={(event) => setSourceRecordId(event.target.value)}
                  />
                </label>
                <MonthCalendarField
                  size="comfortable"
                  allowPast
                  label="Due date"
                  placeholder="Select date"
                  selectedIso={due}
                  minDate={minCalendarDate}
                  onSelect={setDue}
                />
                <p className="md:col-span-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
                  CarePlus owns follow-up for linked risks, incidents and
                  complaints. Completing this Trade note does not close the
                  CarePlus record.
                </p>
              </>
            ) : null}
            {eventType === "staff.credential.submitted" ? (
              <>
                <label className="block space-y-1">
                  <FieldLabel>Credential type</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
                    value={credentialType}
                    onChange={(event) => setCredentialType(event.target.value)}
                  >
                    <option value="Training">Training</option>
                    <option value="Worker screening">Worker screening</option>
                    <option value="Qualification">Qualification</option>
                    <option value="Trade licence">Trade licence</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Issuer</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <FieldLabel>Reference</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
                <MonthCalendarField
                  size="comfortable"
                  allowPast
                  label="Expiry"
                  placeholder="Select date"
                  selectedIso={expiry}
                  minDate={minCalendarDate}
                  onSelect={setExpiry}
                />
                <label className="block space-y-1">
                  <FieldLabel>BMS claimed status</FieldLabel>
                  <select
                    className={SELECT_CLASS}
                    style={{ backgroundImage: SCHEDULE_SELECT_CHEVRON }}
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
              <label className="md:col-span-2 block space-y-1">
                  <FieldLabel>Evidence file</FieldLabel>
                  <input
                  className={INPUT_CLASS}
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
            className="mt-4 rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Sending…" : "Send to CarePlus"}
          </button>
          {ok ? (
            <p
              className={`mt-2 font-body text-[12px] ${
                ok.startsWith("Could not")
                  ? "text-amber-800"
                  : "text-emerald-700"
              }`}
            >
              {ok}
            </p>
          ) : null}
        </section>

      <section className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
        <div className="border-b border-outline-variant/60 px-4 py-3">
          <h2 className="font-headline text-[16px] text-on-surface">
            Delivery and corrections
          </h2>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            You send and retry from here. Receipts: applied, pending_mapping,
            pending_review, rejected, correction_required.
          </p>
        </div>
        <div className="max-h-[min(28rem,55vh)] overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-surface-container font-body text-[12px] text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Correction</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-body text-[13px]">
              {outbox.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-on-surface-variant" colSpan={4}>
                    No CarePlus deliveries yet.
                  </td>
                </tr>
              ) : (
                outbox.map((row) => {
                  const canRetry =
                    row.status === "failed" ||
                    row.status === "retry" ||
                    row.status === "pending" ||
                    row.status === "awaiting_receipt" ||
                    row.processingStatus === "correction_required" ||
                    row.processingStatus === "pending_mapping";
                  return (
                  <tr key={row.eventId} className="border-t border-outline-variant/60">
                    <td className="px-4 py-3">
                      <div>{row.eventType}</div>
                      <div className="font-mono text-[11px] text-on-surface-variant">
                        {row.eventId}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {deliveryStatusLabel(row)}
                      {row.lastErrorCode ? (
                        <div className="mt-0.5 font-body text-[11px] text-on-surface-variant">
                          {row.lastErrorCode}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-amber-800">
                      {row.corrections.map((item) => item.message).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {canRetry ? (
                          <button
                            type="button"
                            disabled={retryingId === row.eventId}
                            onClick={() => void retryRecord(row.eventId)}
                            className="font-body text-[12px] font-semibold text-primary disabled:opacity-50"
                          >
                            {retryingId === row.eventId ? "Retrying…" : "Retry"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={deletingId === row.eventId}
                          onClick={() => void deleteRecord(row.eventId)}
                          className="font-body text-[12px] text-error disabled:opacity-50"
                        >
                          {deletingId === row.eventId ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
