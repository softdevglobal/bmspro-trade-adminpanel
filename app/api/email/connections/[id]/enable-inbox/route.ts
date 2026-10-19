/**
 * POST { return_to? } — starts the opt-in consent upgrade that adds permission
 * to read the mailbox. The existing send connection keeps working if the owner
 * declines or Google refuses.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  createOAuthState,
  getEmailConnectionById,
  parseReturnTo,
} from "@/lib/email-integration/connections";
import { getGoogleOAuthConfig } from "@/lib/email-integration/config";
import { getEmailAdapter } from "@/lib/email-integration/providers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/email/connections/[id]/enable-inbox">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const connection = await getEmailConnectionById(auth.businessId, id);
  if (!connection || connection.status === "disconnected") {
    return emailError(404, "Email connection not found.");
  }
  const adapter = getEmailAdapter(connection.provider);
  if (!adapter || !getGoogleOAuthConfig()) {
    return emailError(503, "Google email is not configured on the server.");
  }

  const body = (await request.json().catch(() => null)) as { return_to?: unknown } | null;
  const { state, codeChallenge } = await createOAuthState({
    uid: auth.uid,
    businessId: auth.businessId,
    provider: connection.provider,
    returnTo: parseReturnTo(body?.return_to),
    enableInbox: true,
  });
  const url = adapter.buildAuthorizationUrl({
    state,
    codeChallenge,
    loginHint: connection.address,
    includeRead: true,
  });
  return NextResponse.json({ ok: true, url });
}
