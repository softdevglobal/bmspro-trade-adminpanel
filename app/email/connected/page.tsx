import { PRODUCT_NAME } from "@/lib/legal/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Mailbox - ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

/** Why connecting failed, in the owner's words (codes from the OAuth callback). */
const REASONS: Record<string, string> = {
  access_denied: "Access was not granted, so nothing was connected.",
  invalid_state: "That connection link expired. Start again from the app.",
  missing_scope: "Permission to send email was not granted. Tick the send permission when connecting.",
  missing_refresh_token: "Offline access wasn't granted, so we couldn't stay connected. Please try again.",
  account_mismatch: "Another mailbox is already connected. Disconnect it in the app first.",
  unverified_email: "That account's email address is not verified.",
  missing_read_scope: "Mailbox access wasn't granted. Sending still works. Try again to allow it.",
  not_enabled: "Email isn't enabled for this business yet.",
};

/**
 * Where the phone's browser lands after connecting Gmail or Outlook from the
 * mobile app: shows the result and sends the owner back to the app.
 */
export default async function EmailConnectedPage({ searchParams }: PageProps<"/email/connected">) {
  const params = await searchParams;
  const result = typeof params.email === "string" ? params.email : "";
  const reason = typeof params.reason === "string" ? params.reason : "";
  const ok = result === "connected" || result === "inbox_enabled";
  const title = ok ? (result === "inbox_enabled" ? "Mailbox enabled" : "Mailbox connected") : "Not connected";
  const message = ok
    ? "Go back to the BMS Pro Trade app. Your mail will appear in Emails."
    : (REASONS[reason] ?? "The mailbox could not be connected. Go back to the app and try again.");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-outline-variant/60 bg-white p-7 text-center shadow-sm">
        <span
          className={`material-symbols-outlined mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-[30px] ${
            ok ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          }`}
          aria-hidden
        >
          {ok ? "mark_email_read" : "error"}
        </span>
        <h1 className="mt-4 font-display text-[22px] font-semibold text-on-surface">{title}</h1>
        <p className="mt-2 font-body text-[14px] leading-relaxed text-on-surface-variant">{message}</p>
        <p className="mt-6 font-body text-[12px] text-on-surface-variant">
          You can close this page. The app refreshes when you switch back to it.
        </p>
      </div>
    </main>
  );
}
