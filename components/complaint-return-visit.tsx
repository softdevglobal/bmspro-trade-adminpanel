"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import type { ReturnVisitPreview } from "@/lib/ai/email/complaints/return-visit";

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;

async function api<T>(user: User, caseId: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/ai/email/complaints/${caseId}/return-visit`, {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result as T;
}

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";

/**
 * Putting it right (docs/sophie-email-learning-and-auto-reply.md §10.10), on one complaint: the free
 * times that fit your rule, the offer you choose to send, what your compensation guide says, and
 * linking the visit once you've booked it in the calendar. Sophie books nothing and moves no money.
 */
export function ComplaintReturnVisit({ caseId, status, offered = [], onChanged }: { caseId: string; status: string; offered?: { date: string; startTime: string; endTime: string; label: string }[]; onChanged: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReturnVisitPreview | null>(null);
  const [ourWork, setOurWork] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [jobs, setJobs] = useState<{ id: string; code: string; status: string; date: string | null; serviceName: string | null }[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function look(confirmed = ourWork) {
    if (!user) return;
    const result = await run(() => api<ReturnVisitPreview>(user, caseId, { method: "POST", body: JSON.stringify({ action: "preview", ownerConfirmsOurWork: confirmed }) }));
    if (result) { setPreview(result); setChosen(result.slots.map((slot) => `${slot.date}|${slot.startTime}`)); }
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !preview) await look();
    if (next && user && !jobs) {
      const result = await run(async () => {
        const response = await fetch(`/api/ai/email/complaints/${caseId}/return-visit`, { headers: { Authorization: "Bearer " + await user.getIdToken() } });
        return (await response.json()) as { jobs?: typeof jobs };
      });
      setJobs(result?.jobs ?? []);
    }
  }

  async function offer() {
    if (!user) return;
    const result = await run(() => api<{ offered: string[] }>(user, caseId, {
      method: "POST",
      body: JSON.stringify({ action: "offer", ownerConfirmsOurWork: ourWork, chosen: chosen.map((value) => { const [date, startTime] = value.split("|"); return { date, startTime }; }) }),
    }));
    if (result) { setNote(`Offer sent: ${result.offered.join(" or ")}. When they pick a time, book it in the calendar and link it below.`); onChanged(); }
  }

  async function book(slot: { date: string; startTime: string; label: string }) {
    if (!user) return;
    const result = await run(() => api<{ code: string }>(user, caseId, { method: "POST", body: JSON.stringify({ action: "book", date: slot.date, startTime: slot.startTime }) }));
    if (result) { setNote(`Booked ${slot.label} as ${result.code}. The customer gets the usual booking email.`); onChanged(); }
  }

  async function link() {
    if (!user || !jobId) return;
    const result = await run(() => api<{ ok: true }>(user, caseId, { method: "POST", body: JSON.stringify({ action: "link", jobId }) }));
    if (result) { setNote("Linked. The case now shows the return visit."); onChanged(); }
  }

  return (
    <div className="space-y-2 border-t border-outline-variant/50 pt-3">
      <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} onClick={() => void toggleOpen()}>
        {open ? "Hide putting it right" : "Put it right"}
      </button>
      {open ? (
        <div className="space-y-3">
          {!preview ? <p className="text-[12px] text-on-surface-variant">Looking at your rule and the calendar…</p> : (
            <>
              {preview.compensation.length > 0 ? (
                <div className="space-y-1 rounded-lg bg-surface-container-low px-3 py-2">
                  <p className="text-[12px] font-semibold text-on-surface">Your compensation guide</p>
                  {preview.compensation.map((item) => (
                    <p key={item.label} className="text-[12px] text-on-surface-variant">
                      {item.label}: {item.verdict === "applies" ? `applies. You could ${item.proposal}. Do it yourself in Invoices; Sophie never changes an invoice.` : item.verdict === "unknown" ? `I can't tell. ${item.why}` : "doesn't apply."}
                    </p>
                  ))}
                </div>
              ) : null}

              {!preview.policyApproved ? (
                <p className="text-[12px] text-on-surface-variant">{preview.noSlotsReason ?? "Approve your return-visit rule in Settings → Sophie to see free times."}</p>
              ) : (
                <>
                  <p className="text-[12px] text-on-surface-variant">{preview.policyText}</p>
                  <label className="flex items-start gap-2 text-[13px] text-on-surface">
                    <input type="checkbox" className="mt-0.5 accent-primary" checked={ourWork} disabled={busy}
                      onChange={(event) => { setOurWork(event.target.checked); void look(event.target.checked); }} />
                    This is our work to put right
                  </label>
                  {preview.applies && !preview.applies.applies ? <p className="text-[12px] text-amber-800">{preview.applies.reason}</p> : null}
                  {preview.slots.length > 0 ? (
                    <fieldset className="space-y-1">
                      <legend className="text-[12px] font-semibold text-on-surface-variant">Free times {preview.noCharge ? "(no charge)" : ""}</legend>
                      {preview.slots.map((slot) => {
                        const value = `${slot.date}|${slot.startTime}`;
                        return (
                          <label key={value} className="flex items-center gap-2 text-[13px] text-on-surface">
                            <input type="checkbox" className="accent-primary" disabled={busy} checked={chosen.includes(value)}
                              onChange={() => setChosen((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />
                            {slot.label}
                          </label>
                        );
                      })}
                    </fieldset>
                  ) : <p className="text-[12px] text-on-surface-variant">{preview.noSlotsReason}</p>}
                  {preview.slots.length > 0 ? (
                    <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busy || !ourWork || chosen.length === 0 || status === "waiting_customer"} onClick={() => void offer()}>
                      Email these times to the customer
                    </button>
                  ) : null}
                </>
              )}

              {status === "waiting_customer" && offered.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[12px] font-semibold text-on-surface">The customer picked a time?</p>
                  {offered.map((slot) => (
                    <button key={`${slot.date}|${slot.startTime}`} type="button" className={`${BUTTON} mr-2 border border-outline-variant bg-white text-on-surface`} disabled={busy} onClick={() => void book(slot)}>Book {slot.label}</button>
                  ))}
                  <p className="text-[11px] text-on-surface-variant">It&apos;s booked at no charge through your normal jobs, and the customer gets the usual booking email.</p>
                </div>
              ) : null}

              <div className="space-y-1">
                <p className="text-[12px] text-on-surface-variant">Once you&apos;ve booked the return visit in the calendar, link it here.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={jobId} disabled={busy || !jobs?.length} className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface" onChange={(event) => setJobId(event.target.value)}>
                    <option value="">{jobs?.length ? "Choose the booked visit…" : "No other open jobs for this customer"}</option>
                    {(jobs ?? []).map((job) => <option key={job.id} value={job.id}>{job.code}{job.date ? ` · ${job.date}` : ""}{job.serviceName ? ` · ${job.serviceName}` : ""}</option>)}
                  </select>
                  <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busy || !jobId} onClick={() => void link()}>Link this visit</button>
                </div>
              </div>
            </>
          )}
          {note ? <p role="status" className="text-[12px] text-emerald-800">{note}</p> : null}
          {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
