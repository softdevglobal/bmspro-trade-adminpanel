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
    };
    if (tokenData.errcode !== 0 || !tokenData.access_token) {
      return jsonError(`Yeastar authentication failed (code ${tokenData.errcode ?? "unknown"}). Check the SDK application's credentials and IP allowlist.`, 502);
    }

    const signUrl = new URL("/openapi/v1.0/sign/create", pbxUrl);
    signUrl.searchParams.set("access_token", tokenData.access_token);
    const signResponse = await fetch(signUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: email, sign_type: "sdk", expire_time: 0 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!signResponse.ok) throw new Error("PBX signature request failed");
    const signData = (await signResponse.json()) as {
      errcode?: number;
      data?: { sign?: string };
    };
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
    // Keep upstream detail out of the response and avoid logging tokens/signatures.
    console.error("[yeastar-sign] Signature request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return jsonError("Could not connect to Yeastar. Check PBX settings and network access.", 502);
  }
}
