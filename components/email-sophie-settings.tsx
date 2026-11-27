"use client";

import { useEffect, useState } from "react";

import { EmailKindList } from "@/components/email-kinds";
import { ComplaintPolicySettings } from "@/components/complaint-policy-settings";
import { EmailTemplateList } from "@/components/email-reply-templates";
import { EmailRuleList } from "@/components/email-rules";
import { EmailSenderLists } from "@/components/email-sender-lists";
import { EmailStyleSettings } from "@/components/email-style-settings";
import type { EmailStyle } from "@/lib/ai/email/style";
import type { StyleSuggestion } from "@/lib/ai/email/style-learning";
import { EMAIL_KIND_LABELS, KINDS_ALWAYS_ON } from "@/lib/ai/email/labels";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";

type Settings = { available: boolean; enabled?: boolean; enabledAt?: number | null; paused?: boolean; summaryHour?: number; kindsOff?: string[]; style?: EmailStyle;
  safetyReply?: { version: number; approved: boolean };
  /** The exact wording, with your business name and phone; null until both are set. */
  safetyReplyText?: string | null;
  /** The owner's usual greeting and sign-off, learnt from their sent email (§8.5). */
  styleSuggestion?: StyleSuggestion | null;
};
type Patch = {
  enabled?: boolean;
  paused?: boolean;
  summaryHour?: number;
  kindOff?: { kind: string; off: boolean };
  style?: { greeting: string; greetingUnknown: string; signOff: string };
  safetyReplyVersion?: number | null;
};

/** Types the owner may tell Sophie to leave alone, in the order of the labels list. */
const OPTIONAL_KINDS = Object.entries(EMAIL_KIND_LABELS).filter(([kind]) => !KINDS_ALWAYS_ON.includes(kind));

const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;

/**
 * Settings → Sophie: the switch for Sophie sorting new email, and Pause
 * (docs/sophie-email-learning-and-auto-reply.md §16). Hidden until the platform switches are on.
 * Also the sender lists, the types Sophie leaves alone, and the rules she learnt (step 7).
 */
export function EmailSophieSettings() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai/email/settings", {
          headers: { Authorization: "Bearer " + await user.getIdToken() },
        });
        const result = await response.json();
        if (!cancelled) setSettings(response.ok ? result : { available: false });
      } catch {
        if (!cancelled) setSettings({ available: false });
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function save(patch: Patch) {
    if (!user || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ai/email/settings", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save Sophie's email settings.");
      // PATCH answers without the safety wording; keep the one already shown.
      // A saved style answers the suggestion; "Not now" is a separate call.
      setSettings((current) => ({ ...result, safetyReplyText: current?.safetyReplyText ?? null, styleSuggestion: patch.style ? null : current?.styleSuggestion ?? null }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Sophie's email settings.");
    } finally {
      setSaving(false);
    }
  }

  async function dismissStyle() {
    if (!user) return;
    setSettings((current) => (current ? { ...current, styleSuggestion: null } : current));
    await fetch("/api/ai/email/style-suggestion", { method: "DELETE", headers: { Authorization: "Bearer " + await user.getIdToken() } }).catch(() => undefined);
  }

  if (!settings?.available) return null;
  const since = settings.enabled && settings.enabledAt
    ? formatInPlatformTimeZone(settings.enabledAt, { dateStyle: "medium", timeStyle: "short" }, profile?.timezone)
    : null;

  return (
    <div className="space-y-3 border-t border-outline-variant/50 pt-5">
      <h4 className="font-display text-sm font-semibold text-on-surface">Email</h4>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant px-3 py-3">
        <span>
          <span className="block text-sm font-semibold text-on-surface">Sophie sorts new email</span>
          <span className="block text-xs text-on-surface-variant">
            {since
              ? `On since ${since}. Only email that arrives after this is sorted.`
              : "Sophie sorts email that arrives after you switch this on, and asks you what to do. Email you already have is left alone. Needs a connected mailbox with inbox access."}
          </span>
        </span>
        <input type="checkbox" role="switch" aria-label="Sophie sorts new email" checked={settings.enabled === true}
          disabled={saving} onChange={event => void save({ enabled: event.target.checked })}
          className="h-4 w-4 shrink-0 accent-primary disabled:opacity-50" />
      </label>
      {settings.enabled && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant px-3 py-3">
          <span>
            <span className="block text-sm font-semibold text-on-surface">Pause Sophie&apos;s email actions</span>
            <span className="block text-xs text-on-surface-variant">Stops everything Sophie hasn&apos;t done yet, straight away. She keeps sorting so nothing is missed.</span>
          </span>
          <input type="checkbox" role="switch" aria-label="Pause Sophie's email actions" checked={settings.paused === true}
            disabled={saving} onChange={event => void save({ paused: event.target.checked })}
            className="h-4 w-4 shrink-0 accent-primary disabled:opacity-50" />
        </label>
      )}
      {settings.enabled && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant px-3 py-3">
          <span>
            <span className="block text-sm font-semibold text-on-surface">Daily email summary</span>
            <span className="block text-xs text-on-surface-variant">A push and a page under Emails → Sophie, once a day in your business time zone.</span>
          </span>
          <select value={settings.summaryHour ?? 17} disabled={saving} aria-label="Daily email summary time"
            onChange={event => void save({ summaryHour: Number(event.target.value) })}
            className="rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-sm text-on-surface">
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
          </select>
        </label>
      )}
      {settings.enabled && <EmailSenderLists />}
      {settings.enabled && <EmailRuleList />}
      {settings.enabled && <EmailKindList />}
      {settings.enabled && <EmailTemplateList />}
      {settings.enabled && <ComplaintPolicySettings />}
      {settings.enabled && settings.safetyReply && (
        <div className="space-y-2 rounded-xl border border-rose-200 px-3 py-3">
          <p className="text-sm font-semibold text-on-surface">Safety reply</p>
          <p className="text-xs text-on-surface-variant">
            When an email says something is dangerous right now (sparks, gas, water near electrics, someone hurt), Sophie tells you at once.
            {settings.safetyReply.approved
              ? " She also sends this reply straight away, at any hour, because waiting could be dangerous."
              : " Approve this reply and she'll also send it straight away, at any hour. Until then she sends nothing."}
            {" "}She never says anything is safe.
          </p>
          {settings.safetyReplyText ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">{settings.safetyReplyText}</pre>
          ) : (
            <p className="text-xs text-error">Add your business name and phone number first: the reply gives them.</p>
          )}
          <button type="button" disabled={saving || (!settings.safetyReply.approved && !settings.safetyReplyText)}
            onClick={() => void save({ safetyReplyVersion: settings.safetyReply!.approved ? null : settings.safetyReply!.version })}
            className={settings.safetyReply.approved
              ? "inline-flex h-9 items-center rounded-lg border border-outline-variant px-3 text-[13px] font-semibold text-on-surface disabled:opacity-50"
              : "inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-on-primary disabled:opacity-50"}>
            {settings.safetyReply.approved ? "Stop sending it" : "Approve this safety reply"}
          </button>
        </div>
      )}
      {settings.enabled && settings.style && settings.styleSuggestion && (
        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-3">
          <p className="text-sm font-semibold text-on-surface">Sophie noticed how you write</p>
          <p className="text-xs text-on-surface-variant">
            From your last {settings.styleSuggestion.samples} emails, you usually start with “{settings.styleSuggestion.greeting}” (or “{settings.styleSuggestion.greetingUnknown}” without a name) and sign off with “{settings.styleSuggestion.signOff}”.
            Sophie only kept those two lines, nothing else from your email. Use them in her replies?
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={saving}
              onClick={() => void save({ style: { greeting: settings.styleSuggestion!.greeting, greetingUnknown: settings.styleSuggestion!.greetingUnknown, signOff: settings.styleSuggestion!.signOff } })}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-on-primary disabled:opacity-50">Use these</button>
            <button type="button" disabled={saving}
              onClick={() => void dismissStyle()}
              className="inline-flex h-9 items-center rounded-lg border border-outline-variant bg-white px-3 text-[13px] font-semibold text-on-surface disabled:opacity-50">Not now</button>
          </div>
        </div>
      )}
      {settings.enabled && settings.style && (
        <EmailStyleSettings key={settings.style.version} style={settings.style} saving={saving} onSave={(style) => save({ style })} />
      )}
      {settings.enabled && (
        <details className="rounded-xl border border-outline-variant px-3 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-on-surface">Email Sophie leaves alone</summary>
          <p className="mt-1 text-xs text-on-surface-variant">
            Ticked types stay in your inbox: Sophie doesn&apos;t ask about them or act on them. She still tells you if one looks like a complaint, a payment or something risky.
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {OPTIONAL_KINDS.map(([kind, label]) => (
              <label key={kind} className="flex items-center gap-2 text-[13px] text-on-surface">
                <input type="checkbox" className="accent-primary" disabled={saving}
                  checked={settings.kindsOff?.includes(kind) ?? false}
                  onChange={event => void save({ kindOff: { kind, off: event.target.checked } })} />
                {label}
              </label>
            ))}
          </div>
        </details>
      )}
      {saving && <p role="status" className="text-xs text-on-surface-variant">Saving…</p>}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  );
}
