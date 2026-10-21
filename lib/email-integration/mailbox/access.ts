import "server-only";

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  getBusinessEmailConnection,
  markConnectionNeedsReconnect,
  type EmailConnectionRecord,
} from "@/lib/email-integration/connections";
import { freshCredentials } from "@/lib/email-integration/credentials";
import type { MailboxAdapter } from "@/lib/email-integration/mailbox/provider";
import { getMailboxAdapter } from "@/lib/email-integration/providers";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";
import type { NextResponse } from "next/server";

/**
 * Shared gate for mailbox routes: an owner/admin of a business whose mailbox
 * is connected and has the needed capability. Credentials only when asked.
 */
export async function requireMailbox(
  request: Request,
  options: { capability: "send" | "read" | "modify"; credentials?: boolean },
): Promise<
  | {
      ok: true;
      uid: string;
      businessId: string;
      connection: EmailConnectionRecord;
      adapter: MailboxAdapter;
      credentials: ProviderCredentials | null;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth;

  const connection = await getBusinessEmailConnection(auth.businessId);
  if (!connection) {
    return { ok: false, response: emailError(404, "No mailbox is connected.", "not_connected") };
  }
  const adapter = getMailboxAdapter(connection.provider);
  if (!adapter) {
    return { ok: false, response: emailError(409, "This mailbox provider isn't supported.") };
  }
  if (connection.status !== "active") {
    return {
      ok: false,
      response: emailError(409, "Reconnect your mailbox to continue.", "needs_reconnect"),
    };
  }
  if (!connection.capabilities.includes(options.capability)) {
    return {
      ok: false,
      response: emailError(
        409,
        options.capability === "modify"
          ? "Allow mailbox management to use this action."
          : "Inbox access isn't enabled for this mailbox.",
        options.capability === "modify" ? "needs_modify" : "not_enabled",
      ),
    };
  }

  let credentials: ProviderCredentials | null = null;
  if (options.credentials) {
    const fresh = await freshCredentials(connection);
    if (!fresh.ok) {
      if (fresh.authFailure) await markConnectionNeedsReconnect(connection, fresh.code);
      return {
        ok: false,
        response: emailError(409, "Reconnect your mailbox to continue.", "needs_reconnect"),
      };
    }
    credentials = fresh.credentials;
  }
  return { ok: true, uid: auth.uid, businessId: auth.businessId, connection, adapter, credentials };
}

/**
 * Provider ids from a URL segment. Outlook ids contain "/", "+" and "=", so
 * the browser percent-encodes them; decode once if they arrive encoded.
 */
export function providerIdParam(raw: string, maxLength = 512): string | null {
  let value = raw;
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9_\-+/=.]+$/.test(value) && value.length <= maxLength ? value : null;
}
