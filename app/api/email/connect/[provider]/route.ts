/**
 * POST — starts mailbox authorisation. Returns the provider URL tied to a
 * short-lived, single-use state bound to this user and business. App-password
 * providers instead take { address, password }, verify them and connect.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  createOAuthState,
  EmailConnectionError,
  getBusinessEmailConnection,
  parseReturnTo,
  saveConnectedAccount,
} from "@/lib/email-integration/connections";
import { getEmailAdapter, parseEmailProvider } from "@/lib/email-integration/providers";
import { ProviderOAuthError } from "@/lib/email-integration/providers/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Checking an app password logs in to IMAP and SMTP.
export const maxDuration = 60;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/email/connect/[provider]">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { provider: rawProvider } = await ctx.params;
  const provider = parseEmailProvider(rawProvider);
  const adapter = provider ? getEmailAdapter(provider) : null;
  if (!provider || !adapter) {
    return emailError(404, "This email provider is not supported.");
  }
  if (!adapter.isConfigured()) {
    return emailError(503, `${adapter.label} isn't configured on the server yet.`);
  }

  const existing = await getBusinessEmailConnection(auth.businessId);
  const body = (await request.json().catch(() => null)) as {
    return_to?: unknown;
    address?: unknown;
    password?: unknown;
    username?: unknown;
    server?: unknown;
  } | null;

  // Password providers (Yahoo, other email): check the login here and save it.
  if (adapter.authMethod === "app_password") {
    const address = typeof body?.address === "string" ? body.address.slice(0, 320) : "";
    const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
    const username = typeof body?.username === "string" ? body.username.slice(0, 320) : "";
    try {
      const account = await adapter.connectWithPassword!({
        address,
        password,
        username,
        server: body?.server,
      });
      await saveConnectedAccount({ businessId: auth.businessId, uid: auth.uid, provider, account });
      return NextResponse.json({ ok: true, connected: true });
    } catch (error) {
      if (error instanceof ProviderOAuthError || error instanceof EmailConnectionError) {
        const status =
          error.code === "account_mismatch" ? 409 : error.code === "server_unreachable" ? 502 : 400;
        return emailError(status, error.message, error.code);
      }
      console.error("[email/connect] app password connect failed");
      return emailError(500, "The mailbox could not be connected. Please try again.");
    }
  }

  // Reconnecting the current mailbox pre-selects that account at the provider.
  const { state, codeChallenge } = await createOAuthState({
    uid: auth.uid,
    businessId: auth.businessId,
    provider,
    returnTo: parseReturnTo(body?.return_to),
    enableInbox: false,
  });
  const url = adapter.buildAuthorizationUrl({
    state,
    codeChallenge,
    loginHint: existing?.provider === provider ? existing.address : null,
  });
  return NextResponse.json({ ok: true, url });
}
