"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import type { RuleView } from "@/lib/ai/email/rules";

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;
type Rules = { offers: RuleView[]; rules: RuleView[] };

async function rulesApi<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result as T;
}

function useRules(refreshKey: number) {
  const { user } = useAuth();
  const [rules, setRules] = useState<Rules | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void rulesApi<Rules>(user, "/api/ai/email/rules")
      .then((result) => { if (!cancelled) setRules(result); })
      .catch(() => { if (!cancelled) setRules(null); });
    return () => { cancelled = true; };
  }, [user, refreshKey, version]);
  return { user, rules, reload: () => setVersion((value) => value + 1) };
}

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";

/**
 * "Want me to do this myself from now on?" (docs/sophie-email-learning-and-auto-reply.md §5.4). The
 * owner approves the exact version shown, in the app; never by voice.
 */
export function EmailRuleOffers({ refreshKey }: { refreshKey: number }) {
  const { user, rules, reload } = useRules(refreshKey);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** The offer being edited, with its choices. */
  const [editing, setEditing] = useState<{ id: string; minConfidence: number; reviewDays: number } | null>(null);

  async function saveEdit(rule: RuleView) {
    if (!user || !editing) return;
    setBusyId(rule.id);
    setError("");
    try {
      await rulesApi(user, `/api/ai/email/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ action: "edit", version: rule.version, minConfidence: editing.minConfidence, reviewDays: editing.reviewDays }) });
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the offer.");
    } finally {
      setBusyId(null);
      reload();
    }
  }

  async function answer(rule: RuleView, action: "approve" | "decline") {
    if (!user) return;
    setBusyId(rule.id);
    setError("");
    try {
      await rulesApi(user, `/api/ai/email/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ action, version: rule.version }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answer.");
    } finally {
      setBusyId(null);
      reload();
    }
  }

  const offers = rules?.offers ?? [];
  if (offers.length === 0) return error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null;
  return (
    <ul className="space-y-3">
      {offers.map((rule) => (
        <li key={rule.id} className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
          <p className="font-body text-[12px] font-semibold text-teal-900">Sophie learnt something</p>
          <p className="text-[13px] text-on-surface">
            {rule.reason ?? `You've handled ${rule.basedOn} emails like this the same way.`} Want me to do this myself from now on?
          </p>
          <p className="rounded-lg bg-white px-3 py-2 text-[13px] text-on-surface">{rule.sentence}</p>
          <p className="text-[12px] text-on-surface-variant">
            I&apos;ll still ask you if anything looks unusual, and you can undo anything I do. I&apos;ll check with you again in 90 days.
          </p>
          {editing?.id === rule.id ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white px-3 py-2">
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Only when I&apos;m at least
                <select value={editing.minConfidence} className="rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-[13px] text-on-surface"
                  onChange={(event) => setEditing({ ...editing, minConfidence: Number(event.target.value) })}>
                  {[0.85, 0.9, 0.95].map((value) => <option key={value} value={value}>{Math.round(value * 100)}% sure</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Ask me again after
                <select value={editing.reviewDays} className="rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-[13px] text-on-surface"
                  onChange={(event) => setEditing({ ...editing, reviewDays: Number(event.target.value) })}>
                  {[30, 60, 90].map((value) => <option key={value} value={value}>{value} days</option>)}
                </select>
              </label>
              <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busyId === rule.id} onClick={() => void saveEdit(rule)}>Save changes</button>
              <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busyId === rule.id} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          ) : (
            <p className="text-[12px] text-on-surface-variant">I only do it when I&apos;m at least {Math.round(rule.minConfidence * 100)}% sure, and I&apos;ll ask again after {rule.reviewDays} days.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busyId === rule.id || editing?.id === rule.id} onClick={() => void answer(rule, "approve")}>
              Yes, do this from now on
            </button>
            <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busyId === rule.id} onClick={() => void answer(rule, "decline")}>
              Keep asking me
            </button>
            <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busyId === rule.id || editing?.id === rule.id}
              onClick={() => setEditing({ id: rule.id, minConfidence: rule.minConfidence, reviewDays: rule.reviewDays })}>
              Edit
            </button>
          </div>
        </li>
      ))}
      {error ? <li role="alert" className="text-[12px] text-error">{error}</li> : null}
    </ul>
  );
}

const LEVEL_LABEL: Record<RuleView["level"], string> = { auto: "Sophie does it", suggest: "Ask me first", off: "Off" };

/**
 * Settings → Sophie → Email rules (§16): what Sophie may do alone. Moving a rule down never needs a
 * confirmation; moving it up to automatic only happens by approving one of her offers.
 */
export function EmailRuleList() {
  const { user, rules, reload } = useRules(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function setLevel(rule: RuleView, level: "suggest" | "off") {
    if (!user) return;
    setBusyId(rule.id);
    setError("");
    try {
      await rulesApi(user, `/api/ai/email/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ action: "level", level }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the rule.");
    } finally {
      setBusyId(null);
      reload();
    }
  }

  if (!rules) return null;
  const all = [...rules.offers, ...rules.rules];
  return (
    <div className="space-y-2 rounded-xl border border-outline-variant px-3 py-3">
      <p className="text-sm font-semibold text-on-surface">What Sophie does by herself</p>
      {all.length === 0 ? (
        <p className="text-xs text-on-surface-variant">Nothing yet. When you answer emails like these the same way a few times, Sophie offers to do it herself, and you decide.</p>
      ) : (
        <ul className="divide-y divide-outline-variant/50">
          {all.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-on-surface">{rule.sentence}</span>
                <span className="block text-xs text-on-surface-variant">
                  {rule.status === "offered" ? "Waiting for your answer under Emails → Sophie." : LEVEL_LABEL[rule.level]}
                  {rule.autoCount > 0 ? ` · done ${rule.autoCount} time${rule.autoCount === 1 ? "" : "s"}` : ""}
                  {rule.undoCount > 0 ? ` · undone ${rule.undoCount}` : ""}
                  {rule.reason && rule.status !== "offered" ? ` · ${rule.reason}` : ""}
                </span>
              </span>
              <select aria-label={`Level for: ${rule.sentence}`} value={rule.level} disabled={busyId === rule.id}
                onChange={(event) => void setLevel(rule, event.target.value === "off" ? "off" : "suggest")}
                className="rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-xs text-on-surface">
                {rule.level === "auto" ? <option value="auto" disabled>Sophie does it</option> : null}
                <option value="suggest">Ask me first</option>
                <option value="off">Off</option>
              </select>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
    </div>
  );
}
