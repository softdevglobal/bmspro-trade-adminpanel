"use client";

import { useEffect, useState } from "react";

import { ComplaintCases } from "@/components/complaint-case-card";
import { EmailDailySummary } from "@/components/email-daily-summary";
import { EmailDecisionCard, type CardChoiceBody, type PickOption } from "@/components/email-decision-card";
import { EmailTemplateOffers } from "@/components/email-reply-templates";
import { EmailRuleOffers } from "@/components/email-rules";
import { EmailSophieActivity } from "@/components/email-sophie-activity";
import { useAuth } from "@/lib/auth/auth-context";
import type { CardView } from "@/lib/ai/email/cards";
import type { EmailAction } from "@/lib/ai/email/types";

type User = NonNullable<ReturnType<typeof useAuth>["user"]>;

type Queue = {
  available: boolean;
  enabled?: boolean;
  paused?: boolean;
  cards?: CardView[];
  kinds?: { kind: string; label: string }[];
  actions?: { action: EmailAction; label: string }[];
};

async function sophieApi<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result as T;
}

/** Whether Sophie's email sorting is switched on for the platform (for showing the Sophie tab). */
export function useSophieEmailAvailable(): boolean {
  const { user } = useAuth();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void sophieApi<{ available: boolean }>(user, "/api/ai/email/settings")
      .then((result) => { if (!cancelled) setAvailable(result.available === true); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, [user]);
  return available;
}

/**
 * Emails → Sophie (docs/sophie-email-learning-and-auto-reply.md §6.1, §6.4): the emails waiting for
 * the owner, the Pause button, and the latest daily summary.
 */
export function EmailSophieQueue({ onEmailCustomer }: { onEmailCustomer: (email: string) => void }) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Bumped after each answer, so "Done recently" shows what Sophie did with it. */
  const [decided, setDecided] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await sophieApi<Queue>(user, "/api/ai/email/cards");
        if (!cancelled) setQueue(result);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Sophie's questions.");
      }
    })();
    return () => { cancelled = true; };
  }, [user, version]);

  async function decide(card: CardView, choice: CardChoiceBody) {
    if (!user) return;
    setBusyId(card.triageId);
    setError("");
    setNotice("");
    try {
      const result = await sophieApi<{ actionsStatus: string; sameInARow: number; ruleOffer: unknown }>(
        user,
        `/api/ai/email/cards/${card.triageId}/decide`,
        { method: "POST", body: JSON.stringify(choice) },
      );
      const repeat = result.ruleOffer
        ? " Sophie has a question for you about emails like this one, above."
        : result.sameInARow > 1 ? ` You've answered emails like this the same way ${result.sameInARow} times in a row.` : "";
      setNotice(result.actionsStatus === "pending"
        ? `Saved.${repeat} Sophie is doing it now; see "Done recently" below.`
        : `Thanks, Sophie has learnt from that.${repeat}`);
      setQueue((current) => current ? { ...current, cards: current.cards?.filter((item) => item.triageId !== card.triageId) } : current);
      // The runner works in the background: look again shortly.
      setDecided((value) => value + 1);
      window.setTimeout(() => setDecided((value) => value + 1), 4000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answer.");
      setVersion((value) => value + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function setPaused(paused: boolean) {
    if (!user) return;
    setError("");
    try {
      const result = await sophieApi<{ paused: boolean }>(user, "/api/ai/email/settings", { method: "PATCH", body: JSON.stringify({ paused }) });
      setQueue((current) => current ? { ...current, paused: result.paused } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change Pause.");
    }
  }

  if (!queue) {
    return error
      ? <p role="alert" className="text-[13px] text-error">{error}</p>
      : <div className="h-24 animate-pulse rounded-2xl bg-surface-container-low" aria-busy="true" />;
  }
  if (!queue.available) return <p className="text-[13px] text-on-surface-variant">Sophie&apos;s email sorting isn&apos;t switched on yet.</p>;
  if (!queue.enabled) {
    return <p className="text-[13px] text-on-surface-variant">Switch on “Sophie sorts new email” in Settings → Sophie settings, and she&apos;ll start with the next email that arrives.</p>;
  }

  const cards = queue.cards ?? [];
  const kinds: PickOption<string>[] = (queue.kinds ?? []).map((item) => ({ value: item.kind, label: item.label }));
  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${queue.paused ? "border-amber-300 bg-amber-50" : "border-outline-variant/60 bg-surface-container-low/70"}`}>
        <p className="text-[13px] text-on-surface">
          {queue.paused
            ? "Sophie's email actions are paused. She keeps sorting so nothing is missed."
            : `${cards.length === 0 ? "Nothing" : cards.length} waiting for you.`}
        </p>
        <button type="button" onClick={() => void setPaused(!queue.paused)}
          className="inline-flex h-9 items-center rounded-lg border border-outline-variant bg-white px-3 text-[13px] font-semibold text-on-surface">
          {queue.paused ? "Resume" : "Pause"}
        </button>
      </div>

      {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}

      <ComplaintCases refreshKey={decided} />

      <EmailRuleOffers refreshKey={decided} />
      <EmailTemplateOffers refreshKey={decided} />

      {cards.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-outline-variant/60 px-5 py-8 text-center text-[13px] text-on-surface-variant">
          No questions right now. New email that needs you will show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.triageId}>
              <EmailDecisionCard
                card={card}
                kinds={kinds}
                actions={queue.actions ?? []}
                busy={busyId === card.triageId}
                onDecide={(choice) => void decide(card, choice)}
                onPreviewReply={(template, details) => user
                  ? sophieApi<{ subject: string; body: string }>(user, `/api/ai/email/cards/${card.triageId}/reply-preview`, { method: "POST", body: JSON.stringify({ template, details }) })
                  : Promise.reject(new Error("Sign in again."))}
                onEmailCustomer={onEmailCustomer}
              />
            </li>
          ))}
        </ul>
      )}

      <EmailSophieActivity refreshKey={decided} />
      <EmailDailySummary />
    </div>
  );
}
