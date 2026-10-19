import "server-only";

import { getGoogleOAuthConfig } from "@/lib/email-integration/config";
import { googleEmailAdapter } from "@/lib/email-integration/providers/google";
import type { EmailSendAdapter } from "@/lib/email-integration/providers/types";
import type { EmailProvider } from "@/lib/email-integration/types";

/** Providers with an adapter. Microsoft and SMTP join this list in later work. */
export function getEmailAdapter(provider: string): EmailSendAdapter | null {
  if (provider === "google") return googleEmailAdapter;
  return null;
}

export function parseEmailProvider(value: string): EmailProvider | null {
  return value === "google" ? "google" : null;
}

/** Providers whose OAuth app credentials are configured. */
export function listConfiguredProviders(): EmailProvider[] {
  return getGoogleOAuthConfig() ? ["google"] : [];
}
