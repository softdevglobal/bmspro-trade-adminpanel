"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";

type Template = { id: string; kind: string; title: string; body: string; version: number; status: string; sampleCount: number };
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

function useTemplates(refreshKey: number) {
  const { user } = useAuth();
  const [data, setData] = useState<{ offers: Template[]; approved: Template[] } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api<{ offers: Template[]; approved: Template[] }>(user, "/api/ai/email/reply-templates")
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [user, refreshKey, version]);
  return { user, data, reload: () => setVersion((value) => value + 1) };
}

function useDecide(user: User | null | undefined, reload: () => void) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function decide(template: Template, action: "approve" | "decline" | "remove") {
    if (!user) return;
    setBusyId(template.id);
    setError("");
    try {
      await api(user, `/api/ai/email/reply-templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ action, version: template.version }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change this reply.");
    } finally {
      setBusyId(null);
      reload();
    }
  }
  return { busyId, error, decide };
}

/**
 * "You keep replying the same way: save it as a reply template?" (docs/sophie-email-learning-and-auto-reply.md
 * §8.1). You read the exact wording, with {firstName} as its only slot, and approve it. Sophie always
 * adds her own signature and that she's an AI. Until you approve it nothing changes.
 */
export function EmailTemplateOffers({ refreshKey }: { refreshKey: number }) {
  const { user, data, reload } = useTemplates(refreshKey);
  const { busyId, error, decide } = useDecide(user, reload);
  const offers = data?.offers ?? [];
  if (offers.length === 0) return error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null;
  return (
    <ul className="space-y-3">
      {offers.map((template) => (
        <li key={template.id} className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
          <p className="font-body text-[12px] font-semibold text-teal-900">Sophie noticed how you reply</p>
          <p className="text-[13px] text-on-surface">You&apos;ve sent much the same reply {template.sampleCount} times: {template.title.toLowerCase()}. Save it as a reply template?</p>
          <p className="whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-[13px] text-on-surface">{template.body}</p>
          <p className="text-[12px] text-on-surface-variant">
            {"{firstName}"} becomes the customer&apos;s first name, or is left out if she isn&apos;t sure of it. Sophie adds her signature, says she&apos;s an AI, and checks it again before every send. Nothing is sent until you choose it on a card, and she only sends it herself after 10 identical answers and a rule you approve.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BUTTON} bg-primary text-on-primary`} disabled={busyId === template.id} onClick={() => void decide(template, "approve")}>Yes, save this exact reply</button>
            <button type="button" className={`${BUTTON} border border-outline-variant bg-white text-on-surface`} disabled={busyId === template.id} onClick={() => void decide(template, "decline")}>No thanks</button>
          </div>
        </li>
      ))}
      {error ? <li role="alert" className="text-[12px] text-error">{error}</li> : null}
    </ul>
  );
}

/** Settings → Sophie: the replies you approved, each removable. */
export function EmailTemplateList() {
  const { user, data, reload } = useTemplates(0);
  const { busyId, error, decide } = useDecide(user, reload);
  if (!data) return null;
  return (
    <details className="rounded-xl border border-outline-variant px-3 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">Your saved replies ({data.approved.length})</summary>
      <p className="mt-1 text-xs text-on-surface-variant">Replies you approved after Sophie noticed you sending them. They show up as a suggestion on cards of the same type.</p>
      {data.approved.length === 0 ? <p className="mt-2 text-xs text-on-surface-variant">None yet.</p> : (
        <ul className="mt-2 divide-y divide-outline-variant/50">
          {data.approved.map((template) => (
            <li key={template.id} className="space-y-1 py-2">
              <p className="text-[13px] font-semibold text-on-surface">{template.title}</p>
              <p className="whitespace-pre-wrap text-[12px] text-on-surface-variant">{template.body}</p>
              <button type="button" className="text-xs font-semibold text-error disabled:opacity-50" disabled={busyId === template.id} onClick={() => void decide(template, "remove")}>Stop using this</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="mt-2 text-xs text-error">{error}</p> : null}
    </details>
  );
}
