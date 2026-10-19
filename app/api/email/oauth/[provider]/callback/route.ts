/**
 * GET — OAuth redirect target. Validates the single-use state, exchanges the
 * code server-side (with the PKCE verifier), verifies the account identity,
 * stores encrypted credentials, then redirects back to Settings.
 */

import { getGoogleOAuthConfig, isEmailSendEnabled } from "@/lib/email-integration/config";
import {
  consumeOAuthState,
  EmailConnectionError,
  saveConnectedAccount,
} from "@/lib/email-integration/connections";
import { getEmailAdapter, parseEmailProvider } from "@/lib/email-integration/providers";
import { GoogleOAuthError } from "@/lib/email-integration/providers/google";
import { resolveAppBaseUrl } from "@/lib/config/base-url";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN_PATHS = {
  emails: "/dashboard/emails",
  settings: "/dashboard/settings",
} as const;

function settingsRedirect(
  request: Request,
  params: Record<string, string>,
  returnTo: keyof typeof RETURN_PATHS = "emails",
) {
  // Return to the origin Google just sent the user to (the registered redirect
  // URI), so local dev on any port and each deployment land back on themselves.
  const redirectUri = getGoogleOAuthConfig()?.redirectUri;
  const base = redirectUri
    ? new URL(redirectUri).origin
    : (resolveAppBaseUrl() ?? new URL(request.url).origin);
  const url = new URL(RETURN_PATHS[returnTo], base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/email/oauth/[provider]/callback">,
) {
  const { provider: rawProvider } = await ctx.params;
  const provider = parseEmailProvider(rawProvider);
  const adapter = provider ? getEmailAdapter(provider) : null;
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") ?? "";
  const code = searchParams.get("code") ?? "";
  const providerError = searchParams.get("error");

  if (!provider || !adapter) {
    return settingsRedirect(request, { email: "error", reason: "unsupported_provider" });
  }

  // Consume the state even on denial so it can never be replayed.
  const stored = await consumeOAuthState(state, provider);
  if (!stored) {
    return settingsRedirect(request, { email: "error", reason: "invalid_state" });
  }
  const { returnTo } = stored;
  if (providerError || !code) {
    return settingsRedirect(
      request,
      {
        email: "error",
        reason: providerError === "access_denied" ? "access_denied" : "authorisation_failed",
      },
      returnTo,
    );
  }
  if (!isEmailSendEnabled(stored.businessId)) {
    return settingsRedirect(request, { email: "error", reason: "not_enabled" }, returnTo);
  }

  try {
    const account = await adapter.exchangeCode({
      code,
      codeVerifier: stored.codeVerifier,
    });
    const saved = await saveConnectedAccount({
      businessId: stored.businessId,
      uid: stored.uid,
      provider,
      account,
    });
    if (stored.enableInbox) {
      // The send connection is kept either way; only report whether read came through.
      return settingsRedirect(
        request,
        saved.capabilities.includes("read")
          ? { email: "inbox_enabled" }
          : { email: "error", reason: "missing_read_scope" },
        returnTo,
      );
    }
    return settingsRedirect(request, { email: "connected" }, returnTo);
  } catch (error) {
    const reason =
      error instanceof GoogleOAuthError || error instanceof EmailConnectionError
        ? error.code
        : "connection_failed";
    console.error("[email/oauth] callback failed", reason);
    return settingsRedirect(request, { email: "error", reason }, returnTo);
  }
}
