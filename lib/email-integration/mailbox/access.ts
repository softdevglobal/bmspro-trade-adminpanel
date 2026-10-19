import "server-only";

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  getBusinessEmailConnection,
  markConnectionNeedsReconnect,
  type EmailConnectionRecord,
} from "@/lib/email-integration/connections";
import { freshCredentials } from "@/lib/email-integration/credentials";
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
  return { ok: true, uid: auth.uid, businessId: auth.businessId, connection, credentials };
}
