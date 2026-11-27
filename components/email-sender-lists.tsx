"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/lib/auth/auth-context";

type Entry = { key: string; list: "private" | "blocked"; kind: "address" | "domain"; display: string; label: string | null; folder: string | null };
type Lists = { private: Entry[]; blocked: Entry[] };

const LISTS = [
  { id: "private", title: "Private senders", hint: "Sophie never reads, summarises, learns from or replies to these. Their email stays in your inbox." },
  { id: "blocked", title: "Blocked senders", hint: "Filed in a folder without Sophie reading them. Use @domain to block a whole domain." },
] as const;

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;

async function senderApi(user: User, path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

/** Settings → Sophie → Email: the private and blocked sender lists (§4.1, §11.3, §16). */
export function EmailSenderLists() {
  const { user } = useAuth();
  const [lists, setLists] = useState<Lists | null>(null);
  /** Bumped after each change to load the lists again. */
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<"private" | "blocked">("private");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await senderApi(user, "/api/ai/email/senders");
        if (!cancelled) setLists(result.available ? { private: result.private, blocked: result.blocked } : null);
      } catch {
        if (!cancelled) setLists(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user, version]);

  const call = (path: string, init?: RequestInit) =>
    user ? senderApi(user, path, init) : Promise.reject(new Error("Sign in again."));

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      setVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await call("/api/ai/email/senders", { method: "POST", body: JSON.stringify({ list, value, label: label || null }) });
      setValue("");
      setLabel("");
    });
  }

  if (!lists) return null;
  return (
    <div className="space-y-3 rounded-xl border border-outline-variant px-3 py-3">
      {LISTS.map(({ id, title, hint }) => (
        <div key={id} className="space-y-1.5">
          <span className="block text-sm font-semibold text-on-surface">{title}</span>
          <span className="block text-xs text-on-surface-variant">{hint}</span>
          {lists[id].length === 0 ? (
            <p className="text-xs text-on-surface-variant">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {lists[id].map((entry) => (
                <li key={entry.key} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 break-all text-on-surface">
                    {entry.display}
                    {entry.label ? <span className="text-on-surface-variant"> · {entry.label}</span> : null}
                    {entry.folder ? <span className="text-on-surface-variant"> → {entry.folder}</span> : null}
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => void run(() => call(`/api/ai/email/senders/${entry.key}?list=${id}`, { method: "DELETE" }))}
                    className="shrink-0 text-xs font-semibold text-primary disabled:opacity-50">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-outline-variant/50 pt-3">
        <label className="grid min-w-48 flex-1 gap-1 text-xs text-on-surface-variant">Email address or @domain
          <input required value={value} onChange={(event) => setValue(event.target.value)} maxLength={254}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface" />
        </label>
        <label className="grid w-32 gap-1 text-xs text-on-surface-variant">Label (optional)
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="e.g. Family"
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface" />
        </label>
        <label className="grid gap-1 text-xs text-on-surface-variant">List
          <select value={list} onChange={(event) => setList(event.target.value as "private" | "blocked")}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface">
            <option value="private">Private</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !value.trim()}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:opacity-50">
          Add
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  );
}
