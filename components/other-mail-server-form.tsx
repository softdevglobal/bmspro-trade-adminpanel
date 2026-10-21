"use client";

import { EmailProviderLogo } from "@/components/email-provider-logo";
import { MAIL_SERVER_PRESETS } from "@/lib/email-integration/client";
import { useState, type FormEvent } from "react";

const INPUT =
  "mt-1 h-10 w-full rounded-xl border border-outline-variant bg-white px-3 font-body text-[13px] text-on-surface outline-none focus:border-primary read-only:bg-surface-container-low";
// The select's own arrow is hidden; SelectArrow draws one with room around it.
const SELECT = `${INPUT} cursor-pointer appearance-none pr-10`;

function SelectArrow() {
  return (
    <span
      aria-hidden
      className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[20px] text-on-surface-variant"
    >
      expand_more
    </span>
  );
}

const LABEL = "font-body text-[12px] font-semibold text-on-surface";

const IMAP_PORTS = [
  { port: 993, label: "993 · SSL/TLS" },
  { port: 143, label: "143 · STARTTLS" },
];
const SMTP_PORTS = [
  { port: 465, label: "465 · SSL/TLS" },
  { port: 587, label: "587 · STARTTLS" },
  { port: 2525, label: "2525 · STARTTLS" },
];

export type OtherMailServerInput = {
  address: string;
  password: string;
  username: string;
  server: { imap_host: string; imap_port: number; smtp_host: string; smtp_port: number };
};

function fillDomain(template: string, address: string): string {
  const domain = address.split("@")[1]?.trim().toLowerCase() ?? "";
  return template.includes("{domain}") ? (domain ? template.replace("{domain}", domain) : "") : template;
}

/**
 * Connect form for "Other email provider": an existing mailbox on Zoho, cPanel
 * hosting or any host with IMAP and SMTP. Presets fill in the servers.
 */
export function OtherMailServerForm({
  initialAddress,
  addressLocked,
  busy,
  primaryClass,
  outlineClass,
  onSubmit,
  onCancel,
}: {
  initialAddress: string;
  addressLocked: boolean;
  busy: boolean;
  primaryClass: string;
  outlineClass: string;
  onSubmit: (input: OtherMailServerInput) => void;
  onCancel: () => void;
}) {
  const [presetId, setPresetId] = useState(MAIL_SERVER_PRESETS[0].id);
  const preset = MAIL_SERVER_PRESETS.find((item) => item.id === presetId) ?? MAIL_SERVER_PRESETS[0];
  const [address, setAddress] = useState(initialAddress);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  // Server fields follow the preset (and the address's domain) until edited.
  const [edited, setEdited] = useState<{ imapHost?: string; smtpHost?: string }>({});
  const [imapPort, setImapPort] = useState(preset.imapPort);
  const [smtpPort, setSmtpPort] = useState(preset.smtpPort);

  const imapHost = edited.imapHost ?? fillDomain(preset.imapHost, address);
  const smtpHost = edited.smtpHost ?? fillDomain(preset.smtpHost, address);

  function choosePreset(id: string) {
    const next = MAIL_SERVER_PRESETS.find((item) => item.id === id) ?? MAIL_SERVER_PRESETS[0];
    setPresetId(next.id);
    setEdited({});
    setImapPort(next.imapPort);
    setSmtpPort(next.smtpPort);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      address,
      password,
      username,
      server: {
        imap_host: imapHost.trim(),
        imap_port: imapPort,
        smtp_host: smtpHost.trim(),
        smtp_port: smtpPort,
      },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-outline-variant/70 bg-white p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant/60 bg-white p-1.5">
          <EmailProviderLogo provider="imap" className="h-full w-full" />
        </span>
        <div className="min-w-0">
          <p className="font-body text-[13px] font-semibold text-on-surface">Connect another email provider</p>
          <p className="mt-0.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
            Use the mailbox you already have with Zoho, your web host (cPanel) or another provider.
            We read your inbox over IMAP and send over SMTP, always encrypted.
          </p>
        </div>
      </div>

      <label className="block">
        <span className={LABEL}>Provider</span>
        <span className="relative block">
          <select
            value={presetId}
            onChange={(event) => choosePreset(event.target.value)}
            className={SELECT}
          >
            {MAIL_SERVER_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <SelectArrow />
        </span>
        <span className="mt-1 block font-body text-[11px] leading-relaxed text-on-surface-variant">
          {preset.hint}
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Email address</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={address}
            readOnly={addressLocked}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="you@yourbusiness.com.au"
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mailbox or app password"
            className={INPUT}
          />
        </label>
      </div>

      <div className="grid gap-3 rounded-xl border border-outline-variant/50 bg-surface-container-low/50 p-3 sm:grid-cols-2">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant sm:col-span-2">
          Incoming (IMAP)
        </p>
        <label className="block">
          <span className={LABEL}>Server</span>
          <input
            required
            value={imapHost}
            onChange={(event) => setEdited((current) => ({ ...current, imapHost: event.target.value }))}
            placeholder="imap.example.com"
            autoCapitalize="off"
            spellCheck={false}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Port</span>
          <span className="relative block">
            <select value={imapPort} onChange={(event) => setImapPort(Number(event.target.value))} className={SELECT}>
              {IMAP_PORTS.map((item) => (
                <option key={item.port} value={item.port}>
                  {item.label}
                </option>
              ))}
            </select>
            <SelectArrow />
          </span>
        </label>
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant sm:col-span-2">
          Outgoing (SMTP)
        </p>
        <label className="block">
          <span className={LABEL}>Server</span>
          <input
            required
            value={smtpHost}
            onChange={(event) => setEdited((current) => ({ ...current, smtpHost: event.target.value }))}
            placeholder="smtp.example.com"
            autoCapitalize="off"
            spellCheck={false}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Port</span>
          <span className="relative block">
            <select value={smtpPort} onChange={(event) => setSmtpPort(Number(event.target.value))} className={SELECT}>
              {SMTP_PORTS.map((item) => (
                <option key={item.port} value={item.port}>
                  {item.label}
                </option>
              ))}
            </select>
            <SelectArrow />
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className={LABEL}>Username (only if it isn&apos;t your email address)</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Leave blank to use the email address"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </label>
      </div>

      <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">
        Your password is encrypted and only used to send and read this mailbox. We check the details
        by signing in to both servers before saving.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? "Checking…" : "Connect"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={outlineClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
