import { getAppBaseUrl } from "@/lib/stripe/config";
import {
  consumeOAuthState,
  exchangeConnectAuthorizationCode,
  saveBusinessConnectAccount,
} from "@/lib/stripe/connect";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Stripe OAuth callback. Resolves the business from the signed state, exchanges
 * the authorization code for the connected account id, and stores it. This
 * endpoint is reached by a browser redirect (no auth header), so identity comes
 * from the single-use state token created when the flow started.
 */
export async function GET(request: Request) {
  const base = getAppBaseUrl();
  const settingsUrl = (query: string) =>
    `${base}/dashboard/settings?${query}`;

  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (error || !code || !state) {
    return NextResponse.redirect(settingsUrl("stripe=error"));
  }

  const businessId = await consumeOAuthState(state);
  if (!businessId) {
    return NextResponse.redirect(settingsUrl("stripe=error"));
  }

  try {
    const accountId = await exchangeConnectAuthorizationCode(code);
    await saveBusinessConnectAccount(businessId, accountId);
    return NextResponse.redirect(settingsUrl("stripe=connected"));
  } catch (err) {
    console.error("[stripe connect] callback failed:", err);
    return NextResponse.redirect(settingsUrl("stripe=error"));
  }
}
