import { timingSafeEqual } from "node:crypto";

export type VoiceBusiness = { did: string; businessId: string };

/** Explicit server-owned bindings; callers and models cannot select a business. */
export function parseVoiceBusinesses(raw: string): VoiceBusiness[] {
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 1000) throw new Error("Invalid voice business configuration.");
  const seen = new Set<string>();
  return items.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid voice business binding.");
    const { did, businessId } = item as Record<string, unknown>;
    if (typeof did !== "string" || !/^\d{6,15}$/.test(did) || seen.has(did) ||
        typeof businessId !== "string" || businessId !== businessId.trim() ||
        !/^[^/]{1,128}$/.test(businessId) || [".", ".."].includes(businessId)) {
      throw new Error("Invalid or duplicate voice business binding.");
    }
    seen.add(did);
    return { did, businessId };
  });
}

export function bridgeCredentialMatches(authorization: string | null, secret: string): boolean {
  const candidate = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] ?? "";
  if (secret.length < 32 || /[\r\n]/.test(secret) || /REPLACE_|YOUR_/.test(secret)) return false;
  const actual = Buffer.from(candidate), expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticateVoiceBridgeCredential(request: Request, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.AI_VOICE_DIRECT_ENABLED !== "true") return { ok: false as const, status: 404 };
  const secret = env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 32 || /[\r\n]/.test(secret) || /REPLACE_|YOUR_/.test(secret)) {
    return { ok: false as const, status: 503 };
  }
  if (!bridgeCredentialMatches(request.headers.get("authorization"), secret)) return { ok: false as const, status: 401 };
  const did = request.headers.get("x-bmspro-did") ?? "";
  if (!/^\d{6,15}$/.test(did)) return { ok: false as const, status: 403 };
  return { ok: true as const, did };
}

export async function authenticateVoiceBridge(request: Request, env: Readonly<Record<string, string | undefined>> = process.env,
  lookup?: (did: string) => Promise<VoiceBusiness | null>) {
  const credential = authenticateVoiceBridgeCredential(request, env);
  if (!credential.ok) return credential;
  const { did } = credential;
  let binding: VoiceBusiness | null;
  try {
    const resolve = lookup ?? (await import("./data/did-mappings")).resolveVoiceDidMapping;
    binding = await resolve(did);
  } catch { return { ok: false as const, status: 503 }; }
  if (!binding) return { ok: false as const, status: 403 };
  if (binding.did !== did) return { ok: false as const, status: 403 };
  const pinned = request.headers.get("x-bmspro-trade-business");
  if (pinned !== null && pinned !== binding.businessId) return { ok: false as const, status: 403 };
  return { ok: true as const, binding };
}
