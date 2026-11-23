import "server-only";

import { z } from "zod";
import { lookupVoiceDidRoute } from "../data/did-mappings";

const bridgeCall = z.object({
  id: z.string().uuid(),
  did: z.string().regex(/^\d{6,15}$/),
  startedAt: z.number().int().positive(),
  canJoin: z.boolean().optional().default(false),
  joinStatus: z.enum(["READY", "ALREADY_REQUESTED", "NOT_TRADE_ROUTE", "NOT_MAPPED", "INVALID_EXTENSION",
    "NOT_CONFIGURED", "MISSING_CALLER_CHANNEL", "INVALID_CALLER_CHANNEL"]).optional(),
});

export function bridgeLiveListenConfig() {
  const value = process.env.AI_LIVE_LISTEN_BRIDGE_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  const secret = process.env.AI_VOICE_BRIDGE_SECRET?.trim() ?? "";
  const privateHost = /^(127\.0\.0\.1|localhost|\[::1\]|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/.test(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && privateHost)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      secret.length < 32 || /[\r\n]|YOUR_|REPLACE_/.test(secret)) throw new Error("Invalid live listening configuration.");
  return { origin: url.origin, secret };
}

export async function joinBridgeCall(config: Config, businessId: string, id: string) {
  if (!bridgeCall.shape.id.safeParse(id).success) return Response.json({ error: "Invalid live call." }, { status: 400 });
  const calls = await listBridgeCalls(config, businessId);
  const call = calls.find(call => call.id === id);
  if (!call) return Response.json({ error: "This live call is no longer available." }, { status: 404 });
  if (!call.canJoin) return Response.json({ error: "Joining is unavailable or already requested for this bridge call." }, { status: 409 });
  const response = await fetch(new URL("/live-listen/join?" + new URLSearchParams({ id }), config.origin), {
    method: "POST", headers: { Authorization: "Bearer " + config.secret, "X-BMSPro-Trade-Business": businessId },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (response.ok && result?.ok === true && result?.status === "REQUESTED") {
    return Response.json({ ok: true, status: "REQUESTED" });
  }
  return Response.json({ error: typeof result?.error === "string" ? result.error
    : "Bridge joining could not be confirmed. Check your extension before retrying." }, {
    status: [400, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502,
  });
}

type Config = NonNullable<ReturnType<typeof bridgeLiveListenConfig>>;

async function bridgeRequest(config: Config, businessId: string, path: string, signal: AbortSignal) {
  return fetch(new URL(path, config.origin), {
    headers: { Authorization: "Bearer " + config.secret, "X-BMSPro-Trade-Business": businessId },
    redirect: "error", cache: "no-store", signal,
  });
}

export async function listBridgeCalls(config: Config, businessId: string) {
  const response = await bridgeRequest(config, businessId, "/live-listen/calls", AbortSignal.timeout(5000));
  if (!response.ok) throw new Error("Live bridge request failed.");
  const calls = z.array(bridgeCall).max(100).parse(await response.json());
  const verified = await Promise.all(calls.map(async call => {
    const route = await lookupVoiceDidRoute(call.did);
    return route.state === "active" && route.binding.businessId === businessId ? call : null;
  }));
  return verified.filter(call => call !== null);
}

export async function listenToBridgeCall(config: Config, businessId: string, id: string, signal: AbortSignal) {
  if (!bridgeCall.shape.id.safeParse(id).success) return null;
  const calls = await listBridgeCalls(config, businessId);
  if (!calls.some(call => call.id === id)) return null;
  const path = "/live-listen/audio?" + new URLSearchParams({ id });
  const response = await bridgeRequest(config, businessId, path, signal);
  if (response.status === 404) return null;
  if (response.status === 429) return Response.json({ error: "This call already has the maximum number of listeners." }, {
    status: 429, headers: { "Cache-Control": "private, no-store" },
  });
  if (!response.ok || !response.body || response.headers.get("content-type") !== "application/octet-stream") {
    throw new Error("Invalid bridge audio response.");
  }
  return new Response(response.body, { headers: {
    "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no",
  } });
}
