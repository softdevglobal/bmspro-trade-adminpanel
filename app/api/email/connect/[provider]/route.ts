/**
 * POST — starts mailbox authorisation. Returns the provider URL tied to a
 * short-lived, single-use state bound to this user and business.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  createOAuthState,
  getBusinessEmailConnection,
  parseReturnTo,
} from "@/lib/email-integration/connections";
import { getEmailAdapter, parseEmailProvider } from "@/lib/email-integration/providers";
import { getGoogleOAuthConfig } from "@/lib/email-integration/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  if (provider === "google" && !getGoogleOAuthConfig()) {
    return emailError(503, "Google email sending is not configured on the server.");
  }

  // Reconnecting the current mailbox pre-selects that account at Google.
  const existing = await getBusinessEmailConnection(auth.businessId);
  const body = (await request.json().catch(() => null)) as { return_to?: unknown } | null;
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
