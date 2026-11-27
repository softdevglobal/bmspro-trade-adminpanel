"use client";

import { useEffect, useState } from "react";

import { EmailGroupAnswer } from "@/components/email-kinds";
import { useAuth } from "@/lib/auth/auth-context";
import type { DailySummary } from "@/lib/ai/email/summary";

/** The latest daily summary (docs/sophie-email-learning-and-auto-reply.md §6.4), under Emails → Sophie. */
export function EmailDailySummary() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  /** Spot checks answered on this page: triageId → what Sophie said back. */
  const [answered, setAnswered] = useState<Record<string, string>>({});

  async function answerSpotCheck(triageId: string, verdict: "right" | "wrong") {
    if (!user) return;
    try {
      const response = await fetch(`/api/ai/email/spot-checks/${triageId}`, {
        method: "POST",
        headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      const result = await response.json();
      const reply = !response.ok ? (result.error ?? "Could not save your answer.")
        : result.demoted ? "Thanks. I'll ask you about emails like that again. To undo what I did, use Done recently above." : "Thanks!";
      setAnswered((current) => ({ ...current, [triageId]: reply }));
    } catch {
      setAnswered((current) => ({ ...current, [triageId]: "Could not save your answer." }));
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai/email/summary", { headers: { Authorization: "Bearer " + await user.getIdToken() } });
        const result = await response.json();
        if (!cancelled && response.ok) setSummary(result.summary ?? null);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (!summary) return null;
  const section = (title: string, items: string[]) => items.length === 0 ? null : (
    <div className="space-y-1">
      <p className="text-[13px] font-semibold text-on-surface">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-on-surface-variant">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-4">
      <h3 className="font-display text-[15px] font-semibold text-on-surface">Sophie&apos;s email summary: {summary.dateLabel}</h3>
      {(summary.openComplaints ?? []).length > 0 ? section(`Open complaints (${summary.openComplaints.length})`, summary.openComplaints.map((item) => `${item.line}${item.overdue ? " (overdue)" : ""}`)) : null}
      {section(`Handled for you (${summary.handledTotal})`, summary.handled.map((item) => item.label))}
      {section(`Waiting for you (${summary.waitingTotal})`, summary.waiting.map((item) => item.since ? `${item.line} (since ${item.since})` : item.line))}
      {summary.newKinds.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-on-surface">New kinds of email: how should I handle these? ({summary.newKinds.length})</p>
          {summary.newKinds.map((item) => answered[`group:${item.label}`] ? (
            <p key={item.label} role="status" className="text-[12px] text-on-surface-variant">{item.label}: {answered[`group:${item.label}`]}</p>
          ) : (
            <EmailGroupAnswer key={item.label} label={item.label} triageIds={item.triageIds}
              onDone={(note) => setAnswered((current) => ({ ...current, [`group:${item.label}`]: note }))} />
          ))}
        </div>
      ) : null}
      {section(`Kind words (${summary.kindWords.length})`, summary.kindWords)}
      {(summary.spotChecks ?? []).length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-on-surface">Check one of mine</p>
          {(summary.spotChecks ?? []).map((item) => (
            <div key={item.triageId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2">
              <span className="text-[13px] text-on-surface-variant">I handled this by myself: {item.line}</span>
              {answered[item.triageId] ? (
                <span role="status" className="text-[12px] text-on-surface-variant">{answered[item.triageId]}</span>
              ) : (
                <span className="flex gap-2">
                  <button type="button" onClick={() => void answerSpotCheck(item.triageId, "right")}
                    className="inline-flex h-8 items-center rounded-lg border border-outline-variant bg-white px-3 text-[12px] font-semibold text-on-surface">Right</button>
                  <button type="button" onClick={() => void answerSpotCheck(item.triageId, "wrong")}
                    className="inline-flex h-8 items-center rounded-lg border border-outline-variant bg-white px-3 text-[12px] font-semibold text-on-surface">Wrong</button>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {summary.privateCount > 0 ? (
        <p className="text-[13px] text-on-surface-variant">Private: {summary.privateCount} email{summary.privateCount === 1 ? "" : "s"} kept private (Sophie did not read {summary.privateCount === 1 ? "it" : "them"}).</p>
      ) : null}
    </section>
  );
}
