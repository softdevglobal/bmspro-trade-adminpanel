"use client";

import { useState } from "react";

import { EmailOwnWords } from "@/components/email-kinds";
import { MailCustomerPanel } from "@/components/mail-customer-panel";
import { defaultActions } from "@/lib/ai/email/action-list";
import type { CardView } from "@/lib/ai/email/cards";
import { needsDetails, type ConfirmedDetails } from "@/lib/ai/email/details";
import { emailKindLabel } from "@/lib/ai/email/labels";
import type { EmailAction, EmailKind } from "@/lib/ai/email/types";

export type CardChoiceBody =
  | { choice: "confirm"; actions: EmailAction[]; details?: ConfirmedDetails }
  | { choice: "change_kind"; kind: string; details?: ConfirmedDetails }
  | { choice: "other_actions"; actions: EmailAction[]; details?: ConfirmedDetails }
  | { choice: "ignore" }
  | { choice: "mark_private" };

type Detailed = Extract<CardChoiceBody, { choice: "confirm" | "change_kind" | "other_actions" }>;

const INPUT = "rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface";

export type PickOption<T> = { value: T; label: string };

const URGENCY: Record<CardView["urgency"], { label: string; tone: string }> = {
  now: { label: "Urgent", tone: "bg-rose-100 text-rose-700" },
  today: { label: "Today", tone: "bg-amber-100 text-amber-800" },
  routine: { label: "When you can", tone: "bg-slate-100 text-slate-600" },
  info: { label: "For your information", tone: "bg-slate-100 text-slate-600" },
};

const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-primary text-on-primary`;
const OUTLINE = `${BUTTON} border border-outline-variant text-on-surface hover:bg-surface-container-low`;

/** The type Sophie sorted a conversation as, shown in the mailbox list. */
export function SophieKindChip({ kind }: { kind: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 font-body text-[11px] font-semibold text-teal-800">
      <span className="material-symbols-outlined text-[13px]">smart_toy</span>
      {emailKindLabel(kind)}
    </span>
  );
}

const sameAction = (a: EmailAction, b: EmailAction) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One decision card (docs/sophie-email-learning-and-auto-reply.md §6.2): what Sophie thinks the email
 * is, what she suggests, and the owner's answer. In shadow mode nothing is done: the answer teaches her.
 */
export function EmailDecisionCard({
  card,
  kinds,
  actions,
  busy,
  onDecide,
  onEmailCustomer,
  onPreviewReply,
}: {
  card: CardView;
  kinds: PickOption<string>[];
  actions: { action: EmailAction; label: string }[];
  busy: boolean;
  onDecide: (choice: CardChoiceBody) => void;
  onEmailCustomer: (email: string) => void;
  /** The exact reply Sophie would send, for the owner to read first (step 8). */
  onPreviewReply?: (template: string, details?: { fullName: string; address: { suburb: string } }) => Promise<{ subject: string; body: string }>;
}) {
  const [ticked, setTicked] = useState<EmailAction[]>(card.suggestions.map((item) => item.action));
  const [mode, setMode] = useState<"main" | "kind" | "other" | "details">(card.manual ? "kind" : "main");
  const [kind, setKind] = useState("");
  const [other, setOther] = useState<EmailAction[]>([]);
  const [showCustomer, setShowCustomer] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string } | { error: string } | null>(null);
  async function showPreview(template: string) {
    if (!onPreviewReply) return;
    try {
      // The form's name is used only when the answer will confirm it, as it is when sending.
      const confirms = !card.shadow && needsDetails(ticked.map((action) => action.kind));
      setPreview(await onPreviewReply(template, confirms ? { fullName: form.fullName, address: { suburb: form.address.suburb } } : undefined));
    } catch (cause) {
      setPreview({ error: cause instanceof Error ? cause.message : "Could not show the reply." });
    }
  }
  /** The answer waiting for the owner to confirm the customer's details (step 6b). */
  const [pending, setPending] = useState<Detailed | null>(null);
  const [form, setForm] = useState<ConfirmedDetails>(() => ({
    fullName: card.prefill?.fullName ?? card.sender.name ?? "",
    phone: card.prefill?.phone ?? "",
    address: card.prefill?.address ?? { street: "", suburb: "", state: "", postcode: "" },
    preferredSlots: [{ date: "", timeRange: "morning" }],
    title: card.prefill?.title ?? card.subject,
    description: card.prefill?.description ?? "",
  }));
  const urgency = URGENCY[card.urgency];
  const confirmLabel = card.shadow ? "That's right" : "Do this";

  const toggle = (list: EmailAction[], action: EmailAction) =>
    list.some((item) => item.kind === action.kind) ? list.filter((item) => item.kind !== action.kind) : [...list, action];

  /** Saving a customer or adding a request needs the owner's confirmed details first, unless nothing will run. */
  function submit(choice: Detailed) {
    const chosen = choice.choice === "change_kind" ? defaultActions(choice.kind as EmailKind) : choice.actions;
    if (!card.shadow && needsDetails(chosen.map((action) => action.kind))) {
      setPending(choice);
      setMode("details");
      return;
    }
    onDecide(choice);
  }
  const wantsRequest = pending !== null && (pending.choice === "change_kind" ? defaultActions(pending.kind as EmailKind) : pending.actions)
    .some((action) => action.kind === "create_inspection" || action.kind === "create_job_request");
  const setAddress = (field: keyof ConfirmedDetails["address"], value: string) =>
    setForm((current) => ({ ...current, address: { ...current.address, [field]: value } }));
  const setSlot = (patch: Partial<ConfirmedDetails["preferredSlots"][number]>) =>
    setForm((current) => ({ ...current, preferredSlots: [{ ...current.preferredSlots[0], ...patch }] }));

  return (
    <article className="space-y-3 rounded-2xl border border-outline-variant/70 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-body text-[12px] font-semibold text-on-surface-variant">
          {card.manual ? "I need your help with this one" : "New email · needs your decision"}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${urgency.tone}`}>{urgency.label}</span>
      </div>

      <div className="space-y-1">
        <p className="break-all font-body text-[13px] text-on-surface">
          <span className="font-semibold">From:</span> {card.sender.name ? `${card.sender.name} <${card.sender.address}>` : card.sender.address}
        </p>
        {card.identity ? <p className="font-body text-[12px] text-on-surface-variant">{card.identity}{card.customerName ? ` · ${card.customerName}` : ""}</p> : null}
        <p className="wrap-break-word font-body text-[13px] text-on-surface"><span className="font-semibold">Subject:</span> {card.subject || "(no subject)"}</p>
        {card.summary ? <p className="font-body text-[13px] text-on-surface-variant">{card.summary}</p> : null}
      </div>

      {card.safetyReply ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800">Safety: {card.safetyReply}</p>
      ) : null}

      {card.replyCommand ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {card.replyCommand === "stop"
            ? "They replied STOP to my email, so I won't email them again."
            : "They asked for a person after my reply. I won't reply in this conversation again."}
        </p>
      ) : null}

      {card.flags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {card.flags.map((flag) => (
            <span key={flag} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">{flag}</span>
          ))}
        </div>
      ) : null}

      {card.manual ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{card.manual}</p>
      ) : card.askPrivate ? (
        <p className="text-[13px] text-on-surface">This looks personal. Mark this sender as private? I&apos;ll never read their email again.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[13px] text-on-surface">
            I think this is: <span className="font-semibold">{card.kindLabel}</span>
            {card.confidence !== null ? ` (${Math.round(card.confidence * 100)}% sure)` : ""}
          </p>
          {card.why ? <p className="text-[12px] text-on-surface-variant">Why: {card.why}</p> : null}
          {card.ruleNote ? <p className="text-[12px] text-on-surface-variant">Why I&apos;m asking: {card.ruleNote}</p> : null}
        </div>
      )}

      {mode === "main" && !card.askPrivate && card.suggestions.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[12px] font-semibold text-on-surface-variant">{card.shadow ? "I would:" : card.fromRule ? "Your rule says:" : "I suggest:"}</legend>
          {card.suggestions.map((item) => (
            <label key={item.action.kind} className="flex items-start gap-2 text-[13px] text-on-surface">
              <input type="checkbox" className="mt-0.5 accent-primary" disabled={busy}
                checked={ticked.some((action) => sameAction(action, item.action))}
                onChange={() => setTicked((list) => toggle(list, item.action))} />
              <span>
                {item.label}
                {item.action.kind === "reply" && onPreviewReply ? (
                  <button type="button" className="ml-2 text-[12px] font-semibold text-primary"
                    onClick={() => (preview ? setPreview(null) : void showPreview(item.action.kind === "reply" ? item.action.template : ""))}>
                    {preview ? "Hide reply" : "Read the reply"}
                  </button>
                ) : null}
              </span>
            </label>
          ))}
          {preview ? (
            "error" in preview
              ? <p role="alert" className="text-[12px] text-error">{preview.error}</p>
              : (
                <div className="rounded-lg border border-outline-variant/70 bg-surface-container-low px-3 py-2">
                  <p className="text-[12px] font-semibold text-on-surface">{preview.subject}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-body text-[12px] text-on-surface-variant">{preview.body}</pre>
                </div>
              )
          ) : null}
        </fieldset>
      ) : null}

      {mode === "kind" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[12px] text-on-surface-variant">What is it?
            <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}
              className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface">
              <option value="">Choose a type…</option>
              {kinds.filter((option) => option.value !== card.kind).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className={PRIMARY} disabled={busy || !kind} onClick={() => submit({ choice: "change_kind", kind })}>Save</button>
          {!card.manual ? <button type="button" className={OUTLINE} disabled={busy} onClick={() => setMode("main")}>Back</button> : null}
        </div>
      ) : null}

      {mode === "other" ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[12px] font-semibold text-on-surface-variant">What should I do instead?</legend>
          {actions.map((item) => (
            <label key={item.action.kind} className="flex items-start gap-2 text-[13px] text-on-surface">
              <input type="checkbox" className="mt-0.5 accent-primary" disabled={busy}
                checked={other.some((action) => action.kind === item.action.kind)}
                onChange={() => setOther((list) => toggle(list, item.action))} />
              {item.label}
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" className={PRIMARY} disabled={busy || other.length === 0} onClick={() => submit({ choice: "other_actions", actions: other })}>Save</button>
            <button type="button" className={OUTLINE} disabled={busy} onClick={() => setMode("main")}>Back</button>
          </div>
          <EmailOwnWords disabled={busy} onConfirm={(chosen) => submit({ choice: "other_actions", actions: chosen })} />
        </fieldset>
      ) : null}

      {mode === "details" && pending ? (
        <form className="space-y-2 rounded-xl border border-outline-variant/70 p-3"
          onSubmit={(event) => { event.preventDefault(); onDecide({ ...pending, details: form }); }}>
          <p className="text-[12px] text-on-surface-variant">
            Check what I found in the email, and fill in anything missing. I&apos;ll only save what you confirm here.
          </p>
          <p className="break-all text-[13px] text-on-surface"><span className="font-semibold">Email:</span> {card.sender.address}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] text-on-surface-variant">Name
              <input required value={form.fullName} maxLength={120} className={INPUT}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-[12px] text-on-surface-variant">Phone
              <input required type="tel" value={form.phone} maxLength={40} className={INPUT}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
          </div>
          {wantsRequest ? (
            <>
              <label className="grid gap-1 text-[12px] text-on-surface-variant">What&apos;s the work?
                <input required value={form.title} maxLength={120} className={INPUT}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </label>
              <label className="grid gap-1 text-[12px] text-on-surface-variant">Notes
                <textarea value={form.description} maxLength={1000} rows={2} className={INPUT}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="grid gap-1 text-[12px] text-on-surface-variant sm:col-span-2">Street (optional)
                  <input value={form.address.street} maxLength={200} className={INPUT} onChange={(event) => setAddress("street", event.target.value)} />
                </label>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Suburb
                  <input value={form.address.suburb} maxLength={80} className={INPUT} onChange={(event) => setAddress("suburb", event.target.value)} />
                </label>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Postcode
                  <input value={form.address.postcode} maxLength={4} inputMode="numeric" className={INPUT} onChange={(event) => setAddress("postcode", event.target.value)} />
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Preferred day
                  <input required type="date" value={form.preferredSlots[0]?.date ?? ""} className={INPUT}
                    onChange={(event) => setSlot({ date: event.target.value })} />
                </label>
                <label className="grid gap-1 text-[12px] text-on-surface-variant">Time
                  <select value={form.preferredSlots[0]?.timeRange ?? "morning"} className={INPUT}
                    onChange={(event) => setSlot({ timeRange: event.target.value === "afternoon" ? "afternoon" : "morning" })}>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                  </select>
                </label>
                {card.prefill?.askedFor.length ? (
                  <p className="pb-2 text-[12px] text-on-surface-variant">They asked for: {card.prefill.askedFor.join(", ")}</p>
                ) : null}
              </div>
              <p className="text-[11px] text-on-surface-variant">It&apos;s added as a pending request: you still confirm the time. The customer gets the usual “request received” email.</p>
            </>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button type="submit" className={PRIMARY} disabled={busy}>Confirm and {confirmLabel.toLowerCase()}</button>
            <button type="button" className={OUTLINE} disabled={busy} onClick={() => { setPending(null); setMode("main"); }}>Back</button>
          </div>
        </form>
      ) : null}

      {mode === "main" ? (
        <div className="flex flex-wrap gap-2">
          {card.askPrivate ? (
            <>
              <button type="button" className={PRIMARY} disabled={busy} onClick={() => onDecide({ choice: "mark_private" })}>Yes, private</button>
              <button type="button" className={OUTLINE} disabled={busy} onClick={() => setMode("kind")}>No, it&apos;s business</button>
            </>
          ) : (
            <>
              <button type="button" className={PRIMARY} disabled={busy || ticked.length === 0} onClick={() => submit({ choice: "confirm", actions: ticked })}>{confirmLabel}</button>
              <button type="button" className={OUTLINE} disabled={busy} onClick={() => setMode("other")}>Do something else</button>
              <button type="button" className={OUTLINE} disabled={busy} onClick={() => onDecide({ choice: "ignore" })}>Ignore this one</button>
              <button type="button" className={OUTLINE} disabled={busy} onClick={() => setMode("kind")}>This isn&apos;t {card.kind ? `a ${card.kindLabel.toLowerCase()}` : "right"}</button>
            </>
          )}
        </div>
      ) : null}

      {card.customerName ? (
        <div>
          <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setShowCustomer((value) => !value)}>
            {showCustomer ? "Hide customer history" : "Show customer history"}
          </button>
          {showCustomer ? (
            <div className="mt-2">
              <MailCustomerPanel
                match={{ method: "customer", customerEmails: [card.sender.address], customerName: card.customerName, document: null }}
                onEmailCustomer={onEmailCustomer}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-outline-variant/50 pt-2 text-[11px] text-on-surface-variant">
        {card.shadow
          ? "Practice mode: Sophie doesn't act on email yet. Your answer teaches her."
          : "If nobody answers: it stays here and is in tonight's summary. Nothing is sent."}
        {card.neverReply ? " Sophie never replies to this sender automatically." : ""}
      </p>
    </article>
  );
}
