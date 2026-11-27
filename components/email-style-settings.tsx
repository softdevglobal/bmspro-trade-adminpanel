"use client";

import { useState, type FormEvent } from "react";

import type { EmailStyle } from "@/lib/ai/email/style";

/**
 * Settings → Sophie → How Sophie writes (docs/sophie-email-learning-and-auto-reply.md §8.5): the
 * greeting and sign-off in her replies. Her signature always says she is an AI assistant.
 */
export function EmailStyleSettings({ style, saving, onSave }: {
  style: EmailStyle;
  saving: boolean;
  onSave: (style: { greeting: string; greetingUnknown: string; signOff: string }) => Promise<void> | void;
}) {
  const [greeting, setGreeting] = useState(style.greeting);
  const [greetingUnknown, setGreetingUnknown] = useState(style.greetingUnknown);
  const [signOff, setSignOff] = useState(style.signOff);
  const changed = greeting !== style.greeting || greetingUnknown !== style.greetingUnknown || signOff !== style.signOff;
  const input = "rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[13px] text-on-surface";

  function submit(event: FormEvent) {
    event.preventDefault();
    void onSave({ greeting, greetingUnknown, signOff });
  }

  const sample = greeting.includes("{firstName}") ? greeting.replace(/\{firstName\}/g, "Priya") : greeting;
  return (
    <details className="rounded-xl border border-outline-variant px-3 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-on-surface">How Sophie writes</summary>
      <form className="mt-2 space-y-2" onSubmit={submit}>
        <p className="text-xs text-on-surface-variant">
          {style.ownerApproved ? "Your own words." : "Sophie's plain default. Change it to sound like you."} Her replies always say she&apos;s an AI assistant at your business, and how to reach you.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-[12px] text-on-surface-variant">Greeting
            <input value={greeting} maxLength={40} disabled={saving} className={input} onChange={(event) => setGreeting(event.target.value)} />
          </label>
          <label className="grid gap-1 text-[12px] text-on-surface-variant">When she doesn&apos;t know their name
            <input value={greetingUnknown} maxLength={40} disabled={saving} className={input} onChange={(event) => setGreetingUnknown(event.target.value)} />
          </label>
          <label className="grid gap-1 text-[12px] text-on-surface-variant">Sign-off
            <input value={signOff} maxLength={40} disabled={saving} className={input} onChange={(event) => setSignOff(event.target.value)} />
          </label>
        </div>
        <p className="text-[11px] text-on-surface-variant">Use {"{firstName}"} in the greeting for the customer&apos;s first name, e.g. “{sample}”.</p>
        <button type="submit" disabled={saving || !changed}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-on-primary disabled:opacity-50">
          Save how Sophie writes
        </button>
      </form>
    </details>
  );
}
