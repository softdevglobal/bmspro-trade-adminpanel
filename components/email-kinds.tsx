"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import type { EmailAction } from "@/lib/ai/email/types";

/**
 * Step 7b (docs/sophie-email-learning-and-auto-reply.md §5.7, §6.3): the owner's own words read back
 * as steps, one answer for a group of emails, and the owner's own email types.
 */

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;
type Labelled = { action: EmailAction; label: string };
type KindsData = {
  custom: { kind: string; label: string; description: string; actions: Labelled[] }[];
  kinds: { kind: string; label: string }[];
  actions: Labelled[];
};

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
const PRIMARY = `${BUTTON} bg-primary text-on-primary`;
const OUTLINE = `${BUTTON} border border-outline-variant bg-white text-on-surface`;
const INPUT = "rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface";
const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

function useKinds(refreshKey = 0) {
  const { user } = useAuth();
  const [data, setData] = useState<KindsData | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api<KindsData>(user, "/api/ai/email/kinds")
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [user, refreshKey, version]);
  return { user, data, reload: () => setVersion((value) => value + 1) };
}

/** "Or tell me in your own words": Sophie reads the steps back, and nothing happens until "Yes". */
export function EmailOwnWords({ disabled, confirmLabel = "Yes, that's right", onConfirm }: {
  disabled?: boolean;
  confirmLabel?: string;
  onConfirm: (actions: EmailAction[]) => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [read, setRead] = useState<{ actions: EmailAction[]; readBack: string; unsupported: string[]; facts: string[] } | null>(null);
  /** Facts already saved as knowledge drafts, with what to tell the owner. */
  const [saved, setSaved] = useState<Record<string, string>>({});

  async function saveFact(fact: string) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ existing: boolean; needsReview: boolean }>(user, "/api/ai/email/knowledge-suggestions", { method: "POST", body: JSON.stringify({ fact }) });
      setSaved((current) => ({ ...current, [fact]: result.existing ? "Already saved." : result.needsReview ? "Saved. It needs a check before it can be published." : "Saved as a draft." }));
    } catch (cause) {
      setError(message(cause, "Could not save that."));
    } finally {
      setBusy(false);
    }
  }

  async function readBack(event: FormEvent) {
    event.preventDefault();
    if (!user || !text.trim()) return;
    setBusy(true);
    setError("");
    setRead(null);
    try {
      setRead(await api(user, "/api/ai/email/own-words", { method: "POST", body: JSON.stringify({ text }) }));
    } catch (cause) {
      setError(message(cause, "I couldn't read that just now."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-outline-variant/70 p-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void readBack(event)}>
        <label className="grid min-w-0 flex-1 gap-1 text-[12px] text-on-surface-variant">Or tell me in your own words
          <input value={text} maxLength={500} disabled={busy || disabled} className={INPUT}
            placeholder="Put these in a Council folder and remind me a week before the date"
            onChange={(event) => { setText(event.target.value); setRead(null); }} />
        </label>
        <button type="submit" className={OUTLINE} disabled={busy || disabled || !text.trim()}>{busy ? "Reading…" : "Read it back"}</button>
      </form>
      {read ? (
        <div className="space-y-1.5 text-[13px] text-on-surface">
          {read.actions.length > 0 ? <p>So I&apos;ll: <span className="font-semibold">{read.readBack}</span> Is that right?</p> : null}
          {read.unsupported.length > 0 ? (
            <p className="text-[12px] text-on-surface-variant">I can&apos;t do this yet, so it stays with you: {read.unsupported.join("; ")}.</p>
          ) : null}
          {read.facts.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[12px] text-on-surface-variant">That sounds like something about your business. Save it as a draft in Sophie&apos;s knowledge, and you publish it on the AI knowledge page when it&apos;s right:</p>
              {read.facts.map((fact) => (
                <div key={fact} className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-on-surface">“{fact}”</span>
                  {saved[fact] ? <span role="status" className="text-[12px] text-emerald-800">{saved[fact]}</span> : (
                    <button type="button" className="text-[12px] font-semibold text-primary" disabled={busy} onClick={() => void saveFact(fact)}>Save as a knowledge draft</button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {read.actions.length > 0 ? (
            <div className="flex gap-2">
              <button type="button" className={PRIMARY} disabled={disabled} onClick={() => onConfirm(read.actions)}>{confirmLabel}</button>
              <button type="button" className={OUTLINE} disabled={disabled} onClick={() => setRead(null)}>No, change it</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
    </div>
  );
}

/** Ticks from the fixed list, with the folder name editable. */
function ActionPicker({ options, value, onChange, disabled }: {
  options: Labelled[];
  value: EmailAction[];
  onChange: (actions: EmailAction[]) => void;
  disabled?: boolean;
}) {
  const ticked = (kind: string) => value.find((action) => action.kind === kind);
  const toggle = (action: EmailAction) => onChange(ticked(action.kind)
    ? value.filter((item) => item.kind !== action.kind)
    : action.kind === "ignore" ? [action] : [...value.filter((item) => item.kind !== "ignore"), action]);
  const folder = ticked("move_folder");
  return (
    <fieldset className="space-y-1.5">
      {options.map((item) => (
        <label key={item.action.kind} className="flex items-start gap-2 text-[13px] text-on-surface">
          <input type="checkbox" className="mt-0.5 accent-primary" disabled={disabled}
            checked={!!ticked(item.action.kind)} onChange={() => toggle(item.action)} />
          {item.action.kind === "move_folder" ? "Move it to a folder" : item.label}
        </label>
      ))}
      {folder && folder.kind === "move_folder" ? (
        <label className="grid gap-1 pl-6 text-[12px] text-on-surface-variant">Folder name
          <input value={folder.folder} maxLength={40} disabled={disabled} className={INPUT}
            onChange={(event) => onChange(value.map((action) => action.kind === "move_folder" ? { kind: "move_folder", folder: event.target.value } : action))} />
        </label>
      ) : null}
    </fieldset>
  );
}

const NEW = "__new__";

/**
 * "How should I handle these?" for one group of emails in the daily summary (§6.3): pick a type, or
 * make a new one, and what to do. One decision is saved for each email in the group.
 */
export function EmailGroupAnswer({ label, triageIds, onDone }: { label: string; triageIds: string[]; onDone: (note: string) => void }) {
  const { user, data } = useKinds();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [actions, setActions] = useState<EmailAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(chosen: EmailAction[]) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const body = kind === NEW
        ? { triageIds, newKind: { name, description }, actions: chosen }
        : { triageIds, kind, ...(chosen.length > 0 ? { actions: chosen } : {}) };
      const result = await api<{ decided: number; skipped: number; running: number; ruleOffer: unknown }>(
        user, "/api/ai/email/groups", { method: "POST", body: JSON.stringify(body) });
      onDone([
        `Saved for ${result.decided} email${result.decided === 1 ? "" : "s"}.`,
        result.skipped > 0 ? `${result.skipped} had already been answered.` : "",
        result.running > 0 ? "Sophie is doing it now." : "",
        result.ruleOffer ? "Sophie has a question for you about emails like these, above." : "",
      ].filter(Boolean).join(" "));
      setOpen(false);
    } catch (cause) {
      setError(message(cause, "Could not save your answer."));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-on-surface-variant">{label}</span>
        <button type="button" className={OUTLINE} onClick={() => setOpen(true)}>Tell Sophie</button>
      </div>
    );
  }
  const custom = data?.custom.find((item) => item.kind === kind);
  const named = kind !== NEW || (name.trim().length >= 2 && description.trim().length >= 5);
  const ready = !!kind && named && (kind !== NEW || actions.length > 0);
  return (
    <div className="space-y-2 rounded-xl border border-outline-variant/70 bg-white p-3">
      <p className="text-[13px] font-semibold text-on-surface">{label}</p>
      <label className="grid gap-1 text-[12px] text-on-surface-variant">What are they?
        <select value={kind} disabled={busy} className={INPUT} onChange={(event) => { setKind(event.target.value); setActions([]); }}>
          <option value="">Choose a type…</option>
          {(data?.kinds ?? []).filter((item) => item.kind !== "unknown").map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          <option value={NEW}>A new type of my own…</option>
        </select>
      </label>
      {kind === NEW ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[12px] text-on-surface-variant">Name
            <input value={name} maxLength={40} disabled={busy} className={INPUT} placeholder="Council letters" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-[12px] text-on-surface-variant">What they&apos;re about
            <input value={description} maxLength={160} disabled={busy} className={INPUT} placeholder="letters from the council about permits" onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
      ) : null}
      {kind ? (
        <>
          <p className="text-[12px] text-on-surface-variant">
            {kind === NEW ? "What should I do with them?" : custom ? `What should I do? Leave these empty for: ${custom.actions.map((item) => item.label).join(", ")}.` : "What should I do? Leave these empty for my usual suggestion."}
          </p>
          <ActionPicker options={data?.actions ?? []} value={actions} onChange={setActions} disabled={busy} />
          <EmailOwnWords disabled={busy || !named}
            confirmLabel="Yes, do this for all of them" onConfirm={(chosen) => void send(chosen)} />
        </>
      ) : null}
      {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className={PRIMARY} disabled={busy || !ready} onClick={() => void send(actions)}>Save for {triageIds.length} email{triageIds.length === 1 ? "" : "s"}</button>
        <button type="button" className={OUTLINE} disabled={busy} onClick={() => setOpen(false)}>Not now</button>
      </div>
    </div>
  );
}

/** Settings → Sophie: the owner's own email types (§16). */
export function EmailKindList() {
  const { user, data, reload } = useKinds();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [actions, setActions] = useState<EmailAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      reload();
      return true;
    } catch (cause) {
      setError(message(cause, "Something went wrong."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const done = await run(() => api(user, "/api/ai/email/kinds", { method: "POST", body: JSON.stringify({ name, description, actions }) }));
    if (done) { setName(""); setDescription(""); setActions([]); }
  }

  if (!data) return null;
  return (
    <details className="rounded-xl border border-outline-variant px-3 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">Your own email types ({data.custom.length})</summary>
      <p className="mt-1 text-xs text-on-surface-variant">Sophie sorts new email into these too, and suggests what you chose. She learns the rest from your answers.</p>
      {data.custom.length > 0 ? (
        <ul className="mt-2 divide-y divide-outline-variant/50">
          {data.custom.map((item) => (
            <li key={item.kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-on-surface">{item.label}</span>
                <span className="block text-xs text-on-surface-variant">{item.description} · {item.actions.map((action) => action.label).join(", ")}</span>
              </span>
              <button type="button" className="text-xs font-semibold text-error disabled:opacity-50" disabled={busy}
                onClick={() => user && void run(() => api(user, `/api/ai/email/kinds/${encodeURIComponent(item.kind.slice("custom:".length))}`, { method: "DELETE" }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="mt-3 space-y-2" onSubmit={(event) => void add(event)}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[12px] text-on-surface-variant">Name
            <input required value={name} maxLength={40} disabled={busy} className={INPUT} placeholder="Council letters" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-[12px] text-on-surface-variant">What they&apos;re about
            <input required value={description} maxLength={160} disabled={busy} className={INPUT} placeholder="letters from the council about permits" onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
        <p className="text-[12px] text-on-surface-variant">What should Sophie suggest?</p>
        <ActionPicker options={data.actions} value={actions} onChange={setActions} disabled={busy} />
        <button type="submit" className={PRIMARY} disabled={busy || actions.length === 0}>Add type</button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs text-error">{error}</p> : null}
    </details>
  );
}
