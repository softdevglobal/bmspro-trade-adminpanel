"use client";

import { useEffect, useState } from "react";

import { ComplaintReturnVisit } from "@/components/complaint-return-visit";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";

type CaseView = {
  id: string;
  typeLabel: string;
  customerName: string | null;
  customerEmail: string | null;
  summary: string;
  status: string;
  replyBy: number;
  jobNote: string | null;
  facts: { label: string; value: string; source: string }[];
  timeline: { at: number; event: string; by: string }[];
  createdAt: number;
  offered: { date: string; startTime: string; endTime: string; label: string }[];
  staffQuestion: { staffName: string | null; status: string; answer: { choice: string; note: string | null } | null } | null;
};

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;

async function api<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result as T;
}

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";

/**
 * Open complaints (docs/sophie-email-learning-and-auto-reply.md §10.4): what the customer said, the
 * facts from your records with where each came from, and what's happened so far. Only you resolve
 * or close a case. Nothing here is ever sent to the customer.
 */
export function ComplaintCases({ refreshKey }: { refreshKey: number }) {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const [cases, setCases] = useState<CaseView[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api<{ cases: CaseView[] }>(user, "/api/ai/email/complaints")
      .then((result) => { if (!cancelled) setCases(result.cases); })
      .catch(() => { if (!cancelled) setCases(null); });
    return () => { cancelled = true; };
  }, [user, refreshKey, version]);

  async function finish(item: CaseView, action: "resolve" | "close" | "acknowledge" | "reopen") {
    if (!user) return;
    setBusyId(item.id);
    setError("");
    try {
      await api(user, `/api/ai/email/complaints/${item.id}`, { method: "PATCH", body: JSON.stringify({ action, note: notes[item.id] || undefined }) });
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the case.");
    } finally {
      setBusyId(null);
    }
  }

  async function askIfFixed(item: CaseView) {
    if (!user) return;
    setBusyId(item.id);
    setError("");
    try {
      await api(user, `/api/ai/email/complaints/${item.id}/follow-up`, { method: "POST", body: "{}" });
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the follow-up.");
    } finally {
      setBusyId(null);
    }
  }

  if (!cases || cases.length === 0) return null;
  const when = (at: number) => formatInPlatformTimeZone(at, { dateStyle: "medium", timeStyle: "short" }, profile?.timezone);
  return (
    <section className="space-y-3">
      <h3 className="font-display text-[15px] font-semibold text-on-surface">Open complaints ({cases.length})</h3>
      {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
      <ul className="space-y-3">
        {cases.map((item) => (
          <li key={item.id} className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-on-surface">{item.typeLabel}{item.customerName ? ` · ${item.customerName}` : ""}</p>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">Reply by {when(item.replyBy)}</span>
            </div>
            {item.customerEmail ? <p className="break-all text-[12px] text-on-surface-variant">{item.customerEmail}</p> : null}
            {item.summary ? <p className="text-[13px] text-on-surface">{item.summary}</p> : null}
            {item.jobNote ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{item.jobNote}</p> : null}
            {item.facts.length > 0 ? (
              <dl className="grid gap-x-3 gap-y-1 text-[12px] sm:grid-cols-[auto_1fr]">
                {item.facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="font-semibold text-on-surface-variant">{fact.label}</dt>
                    <dd className="text-on-surface">{fact.value} <span className="text-on-surface-variant">({fact.source})</span></dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {item.staffQuestion ? (
              <div className="rounded-lg bg-surface-container-low px-3 py-2 text-[12px]">
                <p className="font-semibold text-on-surface">{item.staffQuestion.staffName ?? "The technician"}</p>
                {item.staffQuestion.answer ? (
                  <p className="text-on-surface-variant">{item.staffQuestion.answer.choice}{item.staffQuestion.answer.note ? `: ${item.staffQuestion.answer.note}` : ""} <span>(only you can see this)</span></p>
                ) : (
                  <p className="text-on-surface-variant">{item.staffQuestion.status === "expired" ? "Hasn't answered yet. Silence doesn't mean anything." : "Asked, waiting for an answer."}</p>
                )}
              </div>
            ) : null}
            <ul className="space-y-0.5 border-t border-outline-variant/50 pt-2 text-[12px] text-on-surface-variant">
              {item.timeline.map((event, index) => <li key={index}>{when(event.at)}: {event.event}</li>)}
            </ul>
            <label className="grid gap-1 text-[12px] text-on-surface-variant">Note (optional)
              <input value={notes[item.id] ?? ""} maxLength={500} className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface"
                onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} />
            </label>
            <div className="flex flex-wrap gap-2">
              {item.status === "follow_up" ? (
                <>
                  <button type="button" disabled={busyId === item.id} onClick={() => void askIfFixed(item)} className={`${BUTTON} border border-outline-variant bg-white text-on-surface`}>Ask if it&apos;s fixed</button>
                  <button type="button" disabled={busyId === item.id} onClick={() => void finish(item, "reopen")} className={`${BUTTON} border border-rose-300 bg-rose-50 text-rose-800`}>Still not fixed</button>
                </>
              ) : null}
              {item.status === "escalated" ? (
                <button type="button" disabled={busyId === item.id} onClick={() => void finish(item, "acknowledge")} className={`${BUTTON} border border-rose-300 bg-rose-50 text-rose-800`}>I&apos;ve seen this</button>
              ) : null}
              <button type="button" disabled={busyId === item.id} onClick={() => void finish(item, "resolve")} className={`${BUTTON} bg-primary text-on-primary`}>{item.status === "follow_up" ? "It's fixed" : "Mark resolved"}</button>
              <button type="button" disabled={busyId === item.id} onClick={() => void finish(item, "close")} className={`${BUTTON} border border-outline-variant bg-white text-on-surface`}>Close without resolving</button>
            </div>
            {item.status !== "revisit_booked" && item.status !== "follow_up" ? <ComplaintReturnVisit caseId={item.id} status={item.status} offered={item.offered} onChanged={() => setVersion((value) => value + 1)} /> : null}
            <p className="text-[11px] text-on-surface-variant">Sophie never admits fault, offers money or contacts your team about this. You decide what happens next.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
