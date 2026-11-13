"use client";

import { VOICE_DRAFT_BODY_MAX, VOICE_DRAFT_KINDS, VOICE_DRAFT_TITLE_MAX } from "@/lib/ai/owner-call/voice-draft";
import { discardVoiceDraft, editVoiceDraft, saveVoiceDraft, useVoiceDraft } from "@/lib/ai/owner-call/voice-draft-store";
import { useEffect, useRef } from "react";

const KIND_LABEL = { faq: "FAQ", policy: "Policy", note: "Note" } as const;

/** The rules shown on every voice draft, so the owner knows what happens next. */
const POLICY = [
  "Saved as a draft only. Callers never hear it until you press Publish.",
  "Check every number, price, time and name. Voice can mishear them.",
  "No customer names, phone numbers, emails, passwords or card details.",
  "Write plain facts about your business, not instructions to Sophie.",
];

/**
 * The note Sophie prepared in Talk to Sophie, waiting for the owner's OK.
 * Shown at the top of the AI knowledge page. The owner can edit it, save it as a
 * draft, or discard it; Sophie can also save it after the owner says yes.
 */
export function VoiceDraftCard({ onOpenSaved }: { onOpenSaved: (id: string) => void }) {
  const { draft, status, savedId, needsReview, error } = useVoiceDraft();
  const cardRef = useRef<HTMLElement>(null);
  const draftId = draft?.id;

  // Bring each newly prepared note into view and focus it for keyboard users.
  useEffect(() => {
    if (!draftId) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    cardRef.current?.focus({ preventScroll: true });
  }, [draftId]);

  if (!draft) return null;
  const saving = status === "saving";
  const saved = status === "saved";
  const tooLong = draft.body.trim().length > VOICE_DRAFT_BODY_MAX;
  const valid = draft.title.trim().length >= 2 && draft.body.trim().length >= 10 && !tooLong;

  return (
    <section ref={cardRef} tabIndex={-1} aria-labelledby="voice-draft-title"
      className={`scroll-mt-24 rounded-2xl border-2 p-5 shadow-lg outline-none sm:p-6 ${saved
        ? "border-primary bg-primary/5 ring-4 ring-primary/15"
        : "border-amber-400 bg-amber-50 ring-4 ring-amber-200/70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-[28px] ${saved ? "text-primary" : "text-amber-600"}`}>
            {saved ? "task_alt" : "record_voice_over"}
          </span>
          <div>
            <h2 id="voice-draft-title" className="font-display text-xl font-bold text-on-surface">
              {saved ? "Saved as a draft" : "Draft from Talk to Sophie"}
            </h2>
            <p className="font-body text-[13px] text-on-surface-variant">
              {saved
                ? needsReview
                  ? "Held for review: it may contain contact details or AI-like instructions. Check it before publishing."
                  : "Not published yet. Check it in the list below, then press Publish so Sophie can use it on calls."
                : "Not saved yet. Check it, then say “yes” to Sophie or press Save as draft."}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 font-body text-[12px] font-bold uppercase tracking-wider ${saved ? "bg-primary/15 text-primary" : "bg-amber-200 text-amber-900"}`}>
          {saved ? "Draft · not published" : "Waiting for your OK"}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className="mb-1 block font-body text-[13px] font-semibold text-on-surface">Title</span>
            <input value={draft.title} disabled={saving || saved} maxLength={VOICE_DRAFT_TITLE_MAX}
              onChange={event => editVoiceDraft({ title: event.target.value })}
              className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2.5 font-display text-[18px] font-semibold text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-80" />
          </label>
          <label className="block">
            <span className="mb-1 block font-body text-[13px] font-semibold text-on-surface">Type</span>
            <select value={draft.kind} disabled={saving || saved}
              onChange={event => editVoiceDraft({ kind: event.target.value as (typeof VOICE_DRAFT_KINDS)[number] })}
              className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-80">
              {VOICE_DRAFT_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 flex justify-between font-body text-[13px] font-semibold text-on-surface">
            What Sophie will know
            <span className={`font-normal ${tooLong ? "text-error" : "text-on-surface-variant"}`}>
              {draft.body.trim().length.toLocaleString()} / {VOICE_DRAFT_BODY_MAX.toLocaleString()}
            </span>
          </span>
          <textarea value={draft.body} disabled={saving || saved} rows={5}
            onChange={event => editVoiceDraft({ body: event.target.value })}
            className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2.5 font-body text-[16px] leading-relaxed text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-80" />
        </label>
        {draft.edited && !saved ? (
          <p className="font-body text-[12px] text-on-surface-variant">You changed this on screen. Saving keeps your changes.</p>
        ) : null}
      </div>

      {draft.warnings.length && !saved ? (
        <ul className="mt-4 space-y-1 rounded-xl border border-error/40 bg-error-container/40 px-4 py-3 font-body text-[13px] text-error">
          {draft.warnings.map(warning => (
            <li key={warning} className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px]">warning</span>{warning}
            </li>
          ))}
        </ul>
      ) : null}

      {!saved ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-surface px-4 py-3">
          <p className="font-body text-[13px] font-bold text-on-surface">Before you save</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 font-body text-[13px] text-on-surface-variant">
            {POLICY.map(rule => <li key={rule}>{rule}</li>)}
          </ul>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {saved ? (
          <>
            {savedId ? (
              <button type="button" onClick={() => onOpenSaved(savedId)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary hover:bg-primary/90">
                <span className="material-symbols-outlined text-[18px]">edit</span>Review and publish
              </button>
            ) : null}
            <button type="button" onClick={discardVoiceDraft}
              className="inline-flex h-10 items-center rounded-lg border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low">
              Close
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={saving || !valid} onClick={() => void saveVoiceDraft()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              <span className={`material-symbols-outlined text-[18px] ${saving ? "animate-spin" : ""}`}>{saving ? "progress_activity" : "save"}</span>
              {saving ? "Saving…" : "Save as draft"}
            </button>
            <button type="button" disabled={saving} onClick={discardVoiceDraft}
              className="inline-flex h-10 items-center rounded-lg border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50">
              Discard
            </button>
          </>
        )}
      </div>
    </section>
  );
}
