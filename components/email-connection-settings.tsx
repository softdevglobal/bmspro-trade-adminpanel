"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import {
  EMAIL_PROVIDERS,
  emailApi,
  providerLabel,
  useEmailSending,
} from "@/lib/email-integration/client";
import { useEffect, useState } from "react";

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

/** Owner settings card: connect, reconnect or disconnect the business mailbox (Gmail or Outlook). */
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

  async function handleConnect(provider: string) {
    if (!user) return;
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

  return (
    <SettingsSection
      icon="forward_to_inbox"
      title="Email sending"
      description="Connect your business Gmail or Outlook to send quotes and invoices from your own address and use your mailbox here."
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
                      ? `${label} sign-in expired. Reconnect, then resume any emails on hold.`
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
                Choose your email provider. We only ask for permission to send; reading
                your mailbox here is a separate step you can turn on later.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {EMAIL_PROVIDERS.map((option) => {
                  const ready = providers.includes(option.id);
                  return (
                    <li
                      key={option.id}
                      className="flex flex-col gap-3 rounded-xl border border-outline-variant/70 bg-white p-3.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-body text-[14px] font-bold text-white ${
                            option.id === "google" ? "bg-rose-500" : "bg-sky-600"
                          }`}
                          aria-hidden
                        >
                          {option.id === "google" ? "G" : "O"}
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
                        {busy === option.id ? "Opening sign-in…" : `Connect ${option.label}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

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
