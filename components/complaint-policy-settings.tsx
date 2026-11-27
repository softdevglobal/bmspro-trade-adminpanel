"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";

type Window =
  | { kind: "saturdays"; count: number; startTime: string; endTime: string }
  | { kind: "business_days"; days: number }
  | { kind: "first_free"; withinDays: number };

type Rule = { version: number; window: Window; appliesTo: string[]; maxJobAgeDays: number; noCharge: boolean; weeklyLimit: number };
type Entry = { label: string; when: { kind: "late_over_minutes"; minutes: number } | { kind: "missed_visit" }; proposal: { kind: "discount"; amountAud: number } | { kind: "waive_call_out_fee" } };
type Policies = {
  returnVisit: Rule | null;
  returnVisitApprovedVersion: number | null;
  approved: Rule | null;
  returnVisitText: string | null;
  compensation: { version: number; entries: Entry[] } | null;
};

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;

async function api<T>(user: User, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/ai/email/complaints/policy", {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result as T;
}

const INPUT = "rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface";
const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";
const COVERS: [string, string][] = [
  ["work_unfinished", "The work isn't finished"], ["repeat_fault", "The same fault is back"], ["quality", "Quality of work"],
  ["missed_visit", "A visit was missed"], ["late_arrival", "We were late"], ["no_update", "No update"],
];

/**
 * Settings → Sophie → Return visits and compensation (docs/sophie-email-learning-and-auto-reply.md
 * §10.10). The rule is about TIME: it finds free times for a return visit, and you confirm every
 * offer. The guide is about MONEY and only ever shows "your guide says $30 off" for you to do
 * yourself: Sophie never changes an invoice, refunds or credits anything.
 */
export function ComplaintPolicySettings() {
  const { user } = useAuth();
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [kind, setKind] = useState<Window["kind"]>("saturdays");
  const [count, setCount] = useState(2);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [days, setDays] = useState(2);
  const [withinDays, setWithinDays] = useState(14);
  const [appliesTo, setAppliesTo] = useState<string[]>(["work_unfinished", "repeat_fault"]);
  const [noCharge, setNoCharge] = useState(true);
  const [weeklyLimit, setWeeklyLimit] = useState(5);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api<Policies & { available: boolean }>(user)
      .then((result) => {
        if (cancelled || !result.available) return;
        setPolicies(result);
        if (result.compensation) setEntries(result.compensation.entries);
        const rule = result.returnVisit;
        if (rule) {
          setKind(rule.window.kind);
          if (rule.window.kind === "saturdays") { setCount(rule.window.count); setStartTime(rule.window.startTime); setEndTime(rule.window.endTime); }
          if (rule.window.kind === "business_days") setDays(rule.window.days);
          if (rule.window.kind === "first_free") setWithinDays(rule.window.withinDays);
          setAppliesTo(rule.appliesTo);
          setNoCharge(rule.noCharge);
          setWeeklyLimit(rule.weeklyLimit);
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setPolicies(null); });
    return () => { cancelled = true; };
  }, [user]);

  async function run(init: RequestInit) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      setPolicies(await api<Policies>(user, init));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!policies || !loaded) return null;
  const window: Window = kind === "saturdays" ? { kind, count, startTime, endTime } : kind === "business_days" ? { kind, days } : { kind, withinDays };
  const rule = policies.returnVisit;
  const isApproved = !!rule && policies.returnVisitApprovedVersion === rule.version;
  const setEntry = (index: number, entry: Entry) => setEntries((current) => current.map((item, at) => (at === index ? entry : item)));

  return (
    <details className="rounded-xl border border-outline-variant px-3 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">Return visits and compensation</summary>
      <div className="mt-3 space-y-5">
        <section className="space-y-2">
          <p className="text-sm font-semibold text-on-surface">When we come back</p>
          <p className="text-xs text-on-surface-variant">Sophie finds two free times that fit this and shows them on a complaint. You choose, and you confirm every offer. She never books it.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[12px] text-on-surface-variant">Times
              <select value={kind} disabled={busy} className={INPUT} onChange={(event) => setKind(event.target.value as Window["kind"])}>
                <option value="saturdays">On Saturdays</option>
                <option value="business_days">Within some business days</option>
                <option value="first_free">The first free time</option>
              </select>
            </label>
            {kind === "saturdays" ? (
              <>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Next
                  <select value={count} disabled={busy} className={INPUT} onChange={(event) => setCount(Number(event.target.value))}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} Saturday{n === 1 ? "" : "s"}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">From
                  <input type="time" value={startTime} disabled={busy} className={INPUT} onChange={(event) => setStartTime(event.target.value)} />
                </label>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">To
                  <input type="time" value={endTime} disabled={busy} className={INPUT} onChange={(event) => setEndTime(event.target.value)} />
                </label>
              </>
            ) : null}
            {kind === "business_days" ? (
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Business days
                <input type="number" min={1} max={14} value={days} disabled={busy} className={`${INPUT} w-24`} onChange={(event) => setDays(Number(event.target.value))} />
              </label>
            ) : null}
            {kind === "first_free" ? (
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Look ahead (days)
                <input type="number" min={1} max={30} value={withinDays} disabled={busy} className={`${INPUT} w-24`} onChange={(event) => setWithinDays(Number(event.target.value))} />
              </label>
            ) : null}
          </div>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="mb-1 text-[12px] font-semibold text-on-surface-variant">For these complaints</legend>
            {COVERS.map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 text-[13px] text-on-surface">
                <input type="checkbox" className="accent-primary" disabled={busy} checked={appliesTo.includes(id)}
                  onChange={() => setAppliesTo((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="text-[11px] text-on-surface-variant">Damage, safety, conduct and billing complaints are always yours to handle.</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] text-on-surface">
              <input type="checkbox" className="accent-primary" disabled={busy} checked={noCharge} onChange={(event) => setNoCharge(event.target.checked)} />
              No charge for the return visit (your warranty)
            </label>
            <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">At most
              <input type="number" min={1} max={20} value={weeklyLimit} disabled={busy} className={`${INPUT} w-20`} onChange={(event) => setWeeklyLimit(Number(event.target.value))} />
              a week
            </label>
          </div>
          <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busy || appliesTo.length === 0}
            onClick={() => void run({ method: "PUT", body: JSON.stringify({ returnVisit: { window, appliesTo, noCharge, weeklyLimit } }) })}>
            Save as a new version
          </button>
          {rule && policies.returnVisitText ? (
            <div className="space-y-2 rounded-lg bg-surface-container-low px-3 py-2">
              <p className="text-[12px] font-semibold text-on-surface">Version {rule.version}: {isApproved ? "approved" : "not approved yet"}</p>
              <p className="text-[12px] text-on-surface-variant">{policies.returnVisitText}</p>
              {isApproved ? (
                <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busy}
                  onClick={() => void run({ method: "PATCH", body: JSON.stringify({ action: "withdraw" }) })}>Stop using this rule</button>
              ) : (
                <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busy}
                  onClick={() => void run({ method: "PATCH", body: JSON.stringify({ action: "approve", version: rule.version }) })}>Approve this exact rule</button>
              )}
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <p className="text-sm font-semibold text-on-surface">Compensation guide</p>
          <p className="text-xs text-on-surface-variant">Sophie checks a complaint against these lines and shows what your guide says. She never refunds, credits or changes an invoice: you do it yourself, with one tap on your side.</p>
          {entries.map((entry, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-outline-variant/60 p-2">
              <label className="grid min-w-40 flex-1 gap-1 text-[12px] text-on-surface-variant">In your words
                <input value={entry.label} maxLength={120} disabled={busy} className={INPUT} onChange={(event) => setEntry(index, { ...entry, label: event.target.value })} />
              </label>
              <label className="grid gap-1 text-[12px] text-on-surface-variant">When
                <select value={entry.when.kind} disabled={busy} className={INPUT}
                  onChange={(event) => setEntry(index, { ...entry, when: event.target.value === "missed_visit" ? { kind: "missed_visit" } : { kind: "late_over_minutes", minutes: 60 } })}>
                  <option value="late_over_minutes">We were late by more than</option>
                  <option value="missed_visit">A visit was missed</option>
                </select>
              </label>
              {entry.when.kind === "late_over_minutes" ? (
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Minutes
                  <input type="number" min={5} max={480} value={entry.when.minutes} disabled={busy} className={`${INPUT} w-24`}
                    onChange={(event) => setEntry(index, { ...entry, when: { kind: "late_over_minutes", minutes: Number(event.target.value) } })} />
                </label>
              ) : null}
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Then
                <select value={entry.proposal.kind} disabled={busy} className={INPUT}
                  onChange={(event) => setEntry(index, { ...entry, proposal: event.target.value === "discount" ? { kind: "discount", amountAud: 30 } : { kind: "waive_call_out_fee" } })}>
                  <option value="discount">Take a dollar amount off</option>
                  <option value="waive_call_out_fee">Waive the call-out fee</option>
                </select>
              </label>
              {entry.proposal.kind === "discount" ? (
                <label className="grid gap-1 text-[12px] text-on-surface-variant">$ off
                  <input type="number" min={1} max={10000} step="0.01" value={entry.proposal.amountAud} disabled={busy} className={`${INPUT} w-24`}
                    onChange={(event) => setEntry(index, { ...entry, proposal: { kind: "discount", amountAud: Number(event.target.value) } })} />
                </label>
              ) : null}
              <button type="button" className="text-xs font-semibold text-error" disabled={busy} onClick={() => setEntries((current) => current.filter((_, at) => at !== index))}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {entries.length < 5 ? (
              <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busy}
                onClick={() => setEntries((current) => [...current, { label: "", when: { kind: "late_over_minutes", minutes: 60 }, proposal: { kind: "discount", amountAud: 30 } }])}>Add a line</button>
            ) : null}
            {entries.length > 0 ? (
              <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busy}
                onClick={() => void run({ method: "PUT", body: JSON.stringify({ compensation: entries }) })}>Save the guide</button>
            ) : null}
            {policies.compensation ? (
              <button type="button" className="text-xs font-semibold text-error" disabled={busy}
                onClick={() => { setEntries([]); void run({ method: "PATCH", body: JSON.stringify({ action: "clear_compensation" }) }); }}>Remove the guide</button>
            ) : null}
          </div>
        </section>
        {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
      </div>
    </details>
  );
}
