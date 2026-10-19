"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { emailApi, useEmailSending } from "@/lib/email-integration/client";
import { useEffect, useState } from "react";

const CONNECT_ERRORS: Record<string, string> = {
  access_denied: "Gmail access was not granted, so nothing was connected.",
  invalid_state: "That connection link expired. Please try again.",
  missing_scope:
    "Permission to send email was not granted. Tick the Gmail send permission when connecting.",
  missing_refresh_token: "Google did not grant offline access. Please try again.",
  account_mismatch:
    "Another mailbox is already connected. Disconnect it before connecting a different one.",
  unverified_email: "That Google account's email address is not verified.",
  missing_read_scope:
    "Inbox access wasn't granted, so your Inbox can't be shown. Sending still works. Tick the Gmail read permission to try again.",
  not_enabled: "Email sending is not enabled for this business.",
};

const BUTTON_PRIMARY =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_OUTLINE =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60";

/** Owner settings card: connect, reconnect or disconnect the business Gmail. */
export function EmailConnectionSettings({
  returnTo = "settings",
}: {
  returnTo?: "emails" | "settings";
}) {
  const { user } = useAuth();
  const { loading, enabled, providers, connection, reload } = useEmailSending();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Surface the OAuth callback result once, then tidy the URL.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("email");
    if (!result) return;
    const reason = params.get("reason") ?? "";
    queueMicrotask(() => {
      if (result === "connected") setNotice("Gmail connected.");
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
    // Back from Google via bfcache: the button is still frozen mid-redirect.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setBusy(false);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  if (loading || !enabled) return null;

  async function handleConnect() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { url } = await emailApi<{ url: string }>(user, "/api/email/connect/google", {
        method: "POST",
        body: JSON.stringify({ return_to: returnTo }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the connection.");
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  }

  const needsReconnect = connection?.status === "needs_reconnect";
  const googleReady = providers.includes("google");

  return (
    <SettingsSection
      icon="forward_to_inbox"
      title="Email sending"
      description="Connect your business Gmail to send quotes and invoices from your own address and use your mailbox here."
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
                      ? "Gmail sign-in expired. Reconnect, then resume any emails on hold."
                      : "Gmail connected · can send email"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {needsReconnect ? (
                  <button
                    type="button"
                    disabled={busy || !googleReady}
                    onClick={() => void handleConnect()}
                    className={BUTTON_PRIMARY}
                  >
                    Reconnect
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDisconnect()}
                  className={BUTTON_OUTLINE}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined mt-0.5 text-[20px] text-on-surface-variant">
                  alternate_email
                </span>
                <div>
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    Connect your Gmail account
                  </p>
                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                    {googleReady
                      ? "We only ask for permission to send. We can't read your inbox."
                      : "Gmail sending isn't configured on the server yet."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy || !googleReady}
                onClick={() => void handleConnect()}
                className={BUTTON_PRIMARY}
              >
                {busy ? "Opening Google…" : "Connect Gmail"}
              </button>
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
