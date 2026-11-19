import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Yeastar allows each API application only 8 valid access tokens at once
 * (error 60002 "MAX LIMITATION EXCEEDED" after that), each valid 30 minutes.
 * So one token is reused for every signature until shortly before it
 * expires: kept in memory and in Firestore (admin SDK only), so all server
 * instances share it.
 */
let cachedToken: { key: string; token: string; expiresAt: number } | null = null;
/** After get_token fails, wait before asking again (repeated requests keep a rate-limit block going). */
let tokenFailure: { key: string; errcode: number | string; until: number } | null = null;

async function pbxAccessToken(
  pbxUrl: string,
  accessId: string,
  accessKey: string,
  fresh = false,
): Promise<{ token: string } | { errcode: number | string }> {
  const key = `${pbxUrl}|${accessId}`;
  if (!fresh && cachedToken?.key === key && cachedToken.expiresAt > Date.now()) {
    return { token: cachedToken.token };
  }
  if (tokenFailure?.key === key && tokenFailure.until > Date.now()) {
    return { errcode: tokenFailure.errcode };
  }
  const shared = adminDb.collection("integration_api_tokens")
    .doc(`yeastar-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`);
  if (!fresh) {
    try {
      const stored = (await shared.get()).data();
      if (typeof stored?.token === "string" && typeof stored.expiresAt === "number" && stored.expiresAt > Date.now()) {
        cachedToken = { key, token: stored.token, expiresAt: stored.expiresAt };
        return { token: stored.token };
      }
    } catch {
      // Fall through to a new token.
    }
  }
  const tokenResponse = await fetch(`${pbxUrl}/openapi/v1.0/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: accessId, password: accessKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error("PBX token request failed");
  const tokenData = (await tokenResponse.json()) as {
    errcode?: number;
    access_token?: string;
    access_token_expire_time?: number;
  };
  if (tokenData.errcode !== 0 || !tokenData.access_token) {
    cachedToken = null;
    const errcode = tokenData.errcode ?? "unknown";
    tokenFailure = { key, errcode, until: Date.now() + 60_000 };
    return { errcode };
  }
  tokenFailure = null;
  const lifetimeMs = Math.min((tokenData.access_token_expire_time ?? 1800) * 1000, 30 * 60_000);
  cachedToken = { key, token: tokenData.access_token, expiresAt: Date.now() + lifetimeMs - 2 * 60_000 };
  await shared.set({ token: cachedToken.token, expiresAt: cachedToken.expiresAt, updatedAt: Date.now() })
    .catch(() => undefined);
  return { token: tokenData.access_token };
}

/**
 * Where the mobile Linkus SDK connects: YEASTAR_LINKUS_HOST / YEASTAR_LINKUS_PORT
 * (PBX > Linkus Server > remote access), defaulting to the PBX host and the
 * standard Linkus port 8111. The web softphone ignores this.
 */
function linkusServer(pbx: URL): { host: string; port: number } | null {
  const host = (process.env.YEASTAR_LINKUS_HOST?.trim() || pbx.hostname).toLowerCase();
  const port = Number.parseInt(process.env.YEASTAR_LINKUS_PORT?.trim() || "8111", 10);
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host, port };
}

/**
 * Creates a Yeastar Linkus SDK signature for the authenticated business member.
 * PBX API credentials never leave this server route; the client only receives
 * the short-lived API response containing the per-user SDK signature.
 */
export async function POST(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const email = auth.email?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Your account needs a valid email address for Linkus.", 400);
  }

  const pbxUrl = process.env.YEASTAR_PBX_URL?.trim().replace(/\/$/, "");
  const accessId = process.env.YEASTAR_SDK_ACCESS_ID?.trim();
  const accessKey = process.env.YEASTAR_SDK_ACCESS_KEY;
  if (!pbxUrl || !accessId || !accessKey) {
    return jsonError("Yeastar calling is not configured on this server.", 503);
  }

  let origin: URL;
  try {
    origin = new URL(pbxUrl);
  } catch {
    return jsonError("Yeastar calling is not configured correctly.", 503);
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    return jsonError("Yeastar PBX must use a valid HTTPS URL.", 503);
  }

  try {
    const createSign = async (fresh: boolean) => {
      const access = await pbxAccessToken(pbxUrl, accessId, accessKey, fresh);
      if (!("token" in access)) return { ok: false as const, authError: access.errcode };
      const signUrl = new URL("/openapi/v1.0/sign/create", pbxUrl);
      signUrl.searchParams.set("access_token", access.token);
      const signResponse = await fetch(signUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: email, sign_type: "sdk", expire_time: 0 }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!signResponse.ok) throw new Error("PBX signature request failed");
      return {
        ok: true as const,
        signData: (await signResponse.json()) as { errcode?: number; data?: { sign?: string } },
      };
    };

    let result = await createSign(false);
    // A cached token the PBX no longer accepts: fetch a fresh one once.
    if (result.ok && result.signData.errcode !== 0 && cachedToken) {
      cachedToken = null;
      result = await createSign(true);
    }
    if (!result.ok) {
      return jsonError(`Yeastar authentication failed (code ${result.authError}). Check the SDK application's credentials and IP allowlist, or wait a few minutes if requests were rate limited.`, 502);
    }
    const signData = result.signData;
    const sign = signData.data?.sign;
    if (signData.errcode !== 0) {
      return jsonError(`Yeastar could not create a Linkus signature for ${email} (code ${signData.errcode ?? "unknown"}). Confirm this email belongs to an enabled Linkus extension on the PBX.`, 422);
    }
    if (typeof sign !== "string" || !sign.trim()) {
      throw new Error("PBX returned an empty signature");
    }

    return NextResponse.json(
      {
        ok: true,
        sign,
        pbxUrl: origin.origin,
        // The mobile apps sign in to Linkus as this email with the signature.
        account: email,
        linkus: linkusServer(origin),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // Keep upstream detail out of the response and avoid logging tokens/signatures.
    console.error("[yeastar-sign] Signature request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return jsonError("Could not connect to Yeastar. Check PBX settings and network access.", 502);
  }
}
