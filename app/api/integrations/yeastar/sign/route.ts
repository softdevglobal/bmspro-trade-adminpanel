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

// Yeastar caps the live access tokens per API app (errcode 60002), and every phone start (app or
// dashboard) used to request a new one with a 30-minute lifetime, so a few reloads used them all up
// and business calling failed. Keep one token per process and reuse it until shortly before it expires.
type PbxToken = { value: string; expiresAt: number };
const processCache = globalThis as typeof globalThis & { tradeYeastarSignToken?: Map<string, PbxToken> };
const tokens = processCache.tradeYeastarSignToken ??= new Map();

class TokenLimitError extends Error {}
class TokenAuthError extends Error {
  constructor(readonly code: number | string) { super("PBX authentication failed"); }
}

async function pbxToken(pbxUrl: string, accessId: string, accessKey: string, fresh = false) {
  const key = `${pbxUrl}\n${accessId}`;
  const cached = tokens.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  tokens.delete(key);
  const startedAt = Date.now();
  const response = await fetch(`${pbxUrl}/openapi/v1.0/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: accessId, password: accessKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("PBX token request failed");
  const data = (await response.json()) as { errcode?: number; access_token?: string; access_token_expire_time?: number };
  if (data.errcode === 60002) throw new TokenLimitError("PBX token limit reached");
  if (data.errcode !== 0 || !data.access_token) throw new TokenAuthError(data.errcode ?? "unknown");
  const lifetime = typeof data.access_token_expire_time === "number" && data.access_token_expire_time > 0
    ? Math.min(data.access_token_expire_time, 1800)
    : 1800;
  tokens.set(key, { value: data.access_token, expiresAt: startedAt + lifetime * 1000 - 60_000 });
  return data.access_token;
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

  const createSign = async (token: string) => {
    const signUrl = new URL("/openapi/v1.0/sign/create", pbxUrl);
    signUrl.searchParams.set("access_token", token);
    const signResponse = await fetch(signUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: email, sign_type: "sdk", expire_time: 0 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!signResponse.ok) throw new Error("PBX signature request failed");
    return (await signResponse.json()) as { errcode?: number; data?: { sign?: string } };
  };

  try {
    let signData = await createSign(await pbxToken(pbxUrl, accessId, accessKey));
    // A reused token can be revoked or expire on the PBX early: retry once with a new one.
    if (signData.errcode !== 0) signData = await createSign(await pbxToken(pbxUrl, accessId, accessKey, true));
    const sign = signData.data?.sign;
    if (signData.errcode !== 0) {
      return jsonError(`Yeastar could not create a Linkus signature for ${email} (code ${signData.errcode ?? "unknown"}). Confirm this email belongs to an enabled Linkus extension on the PBX.`, 422);
    }
    if (typeof sign !== "string" || !sign.trim()) {
      throw new Error("PBX returned an empty signature");
    }

    return NextResponse.json(
      { ok: true, sign, pbxUrl: origin.origin },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof TokenLimitError) {
      console.error("[yeastar-sign] PBX token limit reached (60002)");
      return jsonError("Yeastar has too many open API sessions for this app. Wait up to 30 minutes for the old ones to expire, then try again.", 503);
    }
    if (error instanceof TokenAuthError) {
      console.error("[yeastar-sign] PBX authentication failed", { code: error.code });
      return jsonError(`Yeastar authentication failed (code ${error.code}). Check the SDK application's credentials and IP allowlist.`, 502);
    }
    // Keep upstream detail out of the response and avoid logging tokens/signatures.
    console.error("[yeastar-sign] Signature request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return jsonError("Could not connect to Yeastar. Check PBX settings and network access.", 502);
  }
}
