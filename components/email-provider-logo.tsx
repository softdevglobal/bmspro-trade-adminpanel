import type { EmailProvider } from "@/lib/email-integration/types";

/** Brand marks for the supported mailbox providers. */
export function EmailProviderLogo({
  provider,
  className = "h-9 w-9",
}: {
  provider: EmailProvider;
  className?: string;
}) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Google">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    );
  }

  if (provider === "yahoo") {
    return (
      <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Yahoo">
        <rect width="48" height="48" rx="10" fill="#6001D2" />
        <path fill="#fff" d="M7 15h7.6l4.4 11.3L23.5 15H31l-11.4 26h-7.4l3.2-7.2L7 15z" />
        <circle cx="35.5" cy="36" r="3.6" fill="#fff" />
        <path fill="#fff" d="M33.3 12h8.2l-3.6 18.6h-5.6L33.3 12z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Outlook">
      <path fill="#0A64AD" d="M18 8h26a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H18V8z" />
      <path fill="#28A8EA" d="M18 8h26a2 2 0 0 1 2 2v6l-15 9-13-6V8z" />
      <path fill="#0078D4" d="M46 16v22a2 2 0 0 1-2 2H18V19l13 6 15-9z" />
      <path fill="#50D9FF" d="M18 19l13 6 15-9v-6a2 2 0 0 0-2-2H18v11z" opacity=".35" />
      <path fill="#0364B8" d="M2 12.5 22 8v32L2 35.5v-23z" />
      <path
        fill="#fff"
        d="M12 17.5c-3.1 0-5 2.5-5 6.5s1.9 6.5 5 6.5 5-2.5 5-6.5-1.9-6.5-5-6.5zm0 2.5c1.5 0 2.3 1.5 2.3 4s-.8 4-2.3 4-2.3-1.5-2.3-4 .8-4 2.3-4z"
      />
    </svg>
  );
}
