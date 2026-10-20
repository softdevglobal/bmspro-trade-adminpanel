"use client";

import { EmailProviderLogo } from "@/components/email-provider-logo";
import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import {
  EMAIL_PROVIDERS,
  emailApi,
  providerInfo,
  providerLabel,
  useEmailSending,
  type ProviderInfo,
} from "@/lib/email-integration/client";
import { useEffect, useState, type FormEvent } from "react";

const CONNECT_ERRORS: Record<string, string> = {
  access_denied: "Access was not granted, so nothing was connected.",
  invalid_state: "That connection link expired. Please try again.",
  missing_scope:
    "Permission to send email was not granted. Accept the send permission when connecting.",
  missing_refresh_token: "Offline access wasn't granted, so we couldn't stay connected. Please try again.",
  account_mismatch:
    "Another mailbox is already connected. Disconnect it before connecting a different one.",
  unverified_email: "That account's email address is not verified.",
  invalid_identity: "We couldn't confirm which account you signed in with. Please try again.",
  missing_read_scope:
    "Inbox access wasn't granted, so your Inbox can't be shown. Sending still works. Accept the mailbox permission to try again.",
  not_enabled: "Email sending is not enabled for this business.",
};

const BUTTON_PRIMARY =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_OUTLINE =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60";

/** Owner settings card: connect, reconnect or disconnect the business mailbox (Gmail, Outlook or Yahoo). */
export function EmailConnectionSettings({
  returnTo = "settings",
}: {
  returnTo?: "emails" | "settings";
}) {
  const { user } = useAuth();
  const { loading, enabled, providers, connection, reload } = useEmailSending();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** App-password provider whose connect form is open. */
  const [passwordForm, setPasswordForm] = useState<ProviderInfo | null>(null);
  const [formAddress, setFormAddress] = useState("");
  const [formPassword, setFormPassword] = useState("");

  useEffect(() => {
    // Surface the OAuth callback result once, then tidy the URL.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("email");
    if (!result) return;
    const reason = params.get("reason") ?? "";
    queueMicrotask(() => {
      if (result === "connected") setNotice("Mailbox connected.");
      else if (result === "inbox_enabled") setNotice("Mailbox enabled. Your mail is being imported.");
      else setError(CONNECT_ERRORS[reason] ?? "The mailbox could not be connected. Please try again.");
    });
    params.delete("email");
    params.delete("reason");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.toString() ? `?${params}` : ""}`,
    );
  }, []);

  useEffect(() => {
    // Back from the sign-in page via bfcache: the button is still frozen mid-redirect.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setBusy(null);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  if (loading || !enabled) return null;

  function openPasswordForm(option: ProviderInfo, address = "") {
    setPasswordForm(option);
    setFormAddress(address);
    setFormPassword("");
    setError(null);
    setNotice(null);
  }

  async function handlePasswordConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !passwordForm) return;
    setBusy(passwordForm.id);
    setError(null);
    setNotice(null);
    try {
      await emailApi(user, `/api/email/connect/${passwordForm.id}`, {
        method: "POST",
        body: JSON.stringify({ address: formAddress, password: formPassword }),
      });
      setPasswordForm(null);
      setFormPassword("");
      await reload();
      setNotice("Mailbox connected. Your mail is being imported.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect the mailbox.");
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect(provider: string) {
    if (!user) return;
    const option = providerInfo(provider);
    if (option?.authMethod === "app_password") {
      openPasswordForm(option, connection?.provider === provider ? connection.address : "");
      return;
    }
    setBusy(provider);
    setError(null);
    setNotice(null);
    try {
      const { url } = await emailApi<{ url: string }>(user, `/api/email/connect/${provider}`, {
        method: "POST",
        body: JSON.stringify({ return_to: returnTo }),
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the connection.");
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (!user || !connection) return;
    if (
      !window.confirm(
        `Disconnect ${connection.address}? Emails waiting to send will be put on hold.`,
      )
    ) {
      return;
    }
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    try {
      await emailApi(user, `/api/email/connections/${encodeURIComponent(connection.id)}`, {
        method: "DELETE",
      });
      await reload();
      setNotice("Mailbox disconnected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect the mailbox.");
    } finally {
      setBusy(null);
    }
  }

  const needsReconnect = connection?.status === "needs_reconnect";
  const label = providerLabel(connection?.provider);
  const usesAppPassword = providerInfo(connection?.provider)?.authMethod === "app_password";

  const passwordFormPanel = passwordForm ? (
    <form
      onSubmit={(event) => void handlePasswordConnect(event)}
      className="space-y-3 rounded-xl border border-outline-variant/70 bg-white p-4"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant/60 bg-white p-1.5">
          <EmailProviderLogo provider={passwordForm.id} className="h-full w-full" />
        </span>
        <div className="min-w-0">
          <p className="font-body text-[13px] font-semibold text-on-surface">
            Connect {passwordForm.label}
          </p>
          <p className="mt-0.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
            {`${passwordForm.company} doesn't let other apps use your normal password.`} Create an
            app password in your {passwordForm.company} account (Account security → Generate app
            password), then paste it here.{" "}
            {passwordForm.appPasswordHelpUrl ? (
              <a
                href={passwordForm.appPasswordHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                How to create one
              </a>
            ) : null}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-body text-[12px] font-semibold text-on-surface">Email address</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={formAddress}
            readOnly={Boolean(connection && connection.provider === passwordForm.id)}
            onChange={(event) => setFormAddress(event.target.value)}
            placeholder="you@yahoo.com"
            className="mt-1 h-10 w-full rounded-xl border border-outline-variant bg-white px-3 font-body text-[13px] text-on-surface outline-none focus:border-primary read-only:bg-surface-container-low"
          />
        </label>
        <label className="block">
          <span className="font-body text-[12px] font-semibold text-on-surface">App password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={formPassword}
            onChange={(event) => setFormPassword(event.target.value)}
            placeholder="16-letter app password"
            className="mt-1 h-10 w-full rounded-xl border border-outline-variant bg-white px-3 font-body text-[13px] text-on-surface outline-none focus:border-primary"
          />
        </label>
      </div>
      <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">
        The app password is encrypted and only used to send and read this mailbox. You can
        remove it in your {passwordForm.company} account at any time.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={Boolean(busy)} className={BUTTON_PRIMARY}>
          {busy === passwordForm.id ? "Checking…" : "Connect"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => setPasswordForm(null)}
          className={BUTTON_OUTLINE}
        >
          Cancel
        </button>
      </div>
    </form>
  ) : null;

  return (
    <SettingsSection
      icon="forward_to_inbox"
      title="Email sending"
      description="Connect your business Gmail, Outlook or Yahoo Mail to send quotes and invoices from your own address and use your mailbox here."
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/70 px-4 py-3.5">
          {connection ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <span
                  className={`material-symbols-outlined mt-0.5 text-[20px] ${
                    needsReconnect ? "text-amber-500" : "text-primary"
                  }`}
                >
                  {needsReconnect ? "warning" : "mark_email_read"}
                </span>
                <div className="min-w-0">
                  <p className="break-all font-body text-[13px] font-semibold text-on-surface">
                    {connection.address}
                  </p>
                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                    {needsReconnect
                      ? usesAppPassword
                        ? `${label} stopped accepting the app password. Reconnect with a new one, then resume any emails on hold.`
                        : `${label} sign-in expired. Reconnect, then resume any emails on hold.`
                      : `${label} connected · can send email`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {needsReconnect ? (
                  <button
                    type="button"
                    disabled={Boolean(busy) || !providers.includes(connection.provider)}
                    onClick={() => void handleConnect(connection.provider)}
                    className={BUTTON_PRIMARY}
                  >
                    Reconnect
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void handleDisconnect()}
                  className={BUTTON_OUTLINE}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-body text-[13px] text-on-surface">
                Choose your email provider. Gmail and Outlook first ask only for permission
                to send; reading your mailbox here is a separate step you can turn on later.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {EMAIL_PROVIDERS.map((option) => {
                  const ready = providers.includes(option.id);
                  return (
                    <li
                      key={option.id}
                      className="flex flex-col gap-3 rounded-xl border border-outline-variant/70 bg-white p-3.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant/60 bg-white p-1.5">
                          <EmailProviderLogo provider={option.id} className="h-full w-full" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-body text-[13px] font-semibold text-on-surface">{option.title}</p>
                          <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                            {ready ? option.description : "Not set up on the server yet."}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !ready}
                        onClick={() => void handleConnect(option.id)}
                        className={BUTTON_PRIMARY}
                      >
                        {busy === option.id
                          ? option.authMethod === "app_password"
                            ? "Checking…"
                            : "Opening sign-in…"
                          : `Connect ${option.label}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {passwordFormPanel}

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-body text-[12px] text-emerald-800"
          >
            {notice}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
