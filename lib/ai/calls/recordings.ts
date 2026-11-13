import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { DID_RECORDING_PERIODS_COLLECTION } from "../data/did-mappings";

const pageSize = 50;
const recordingFile = z.string().regex(/^[a-zA-Z0-9_.-]{1,240}\.(wav|mp3)$/i);
const grantSchema = z.object({
  businessId: z.string(), file: recordingFile, expiresAt: z.number(), origin: z.string(),
});

export function recordingConfig() {
  const trunks = [...new Set((process.env.YEASTAR_RECORDING_TRUNKS ?? "").split(",").map(value => value.trim()).filter(Boolean))];
  const username = process.env.YEASTAR_RECORDING_CLIENT_ID?.trim();
  const secret = process.env.YEASTAR_RECORDING_CLIENT_SECRET?.trim();
  const pbxUrl = process.env.YEASTAR_PBX_URL?.trim();
  if (!username || !secret || !pbxUrl || !trunks.length || trunks.some(value => /[:\r\n]/.test(value))) return null;
  let url: URL;
  try { url = new URL(pbxUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return { origin: url.origin, username, secret, trunks };
}

type Config = NonNullable<ReturnType<typeof recordingConfig>>;

const callbackClaim = z.object({
  businessId: z.string(), callerKey: z.string().regex(/^\d{6,32}$/),
  startedAt: z.number().int().nonnegative(), expiresAt: z.number(),
});

function signCallback(config: Config, payload: string) {
  return createHmac("sha256", config.secret).update("trade-callback:" + payload).digest();
}

export function verifyCallbackGrant(config: Config, businessId: string, grant: string) {
  if (!/^[\w-]{1,1000}\.[\w-]{43}$/.test(grant)) return null;
  const [payload, signature] = grant.split(".");
  const actual = Buffer.from(signature, "base64url");
  const expected = signCallback(config, payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = callbackClaim.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success && parsed.data.businessId === businessId && parsed.data.expiresAt > Date.now()
      ? parsed.data : null;
  } catch {
    return null;
  }
}

function sign(config: Config, payload: string) {
  return createHmac("sha256", config.secret).update("trade-recording:" + payload).digest();
}

function issueGrant(config: Config, businessId: string, file: string) {
  const payload = Buffer.from(JSON.stringify({
    businessId, file, origin: config.origin, expiresAt: Date.now() + 10 * 60_000,
  })).toString("base64url");
  return payload + "." + sign(config, payload).toString("base64url");
}

export function recordingFileForGrant(config: Config, businessId: string, grant: string) {
  if (!/^[\w-]{1,2000}\.[\w-]{43}$/.test(grant)) return null;
  const [payload, signature] = grant.split(".");
  const actual = Buffer.from(signature, "base64url");
  const expected = sign(config, payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const result = grantSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!result.success || result.data.businessId !== businessId || result.data.origin !== config.origin ||
        result.data.expiresAt <= Date.now()) return null;
    return result.data.file;
  } catch { return null; }
}

const requestOptions = () => ({ cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) } as const);

type PbxToken = { value: string; expiresAt: number };
const processCache = globalThis as typeof globalThis & {
  tradeRecordingTokenRequests?: Map<string, Promise<PbxToken>>;
};
const tokenRequests = processCache.tradeRecordingTokenRequests ??= new Map();

function tokenKey(config: Config) {
  return createHash("sha256").update(JSON.stringify([config.origin, config.username, config.secret])).digest("hex");
}

export class RecordingTokenLimitError extends Error {}
export class RecordingAccessError extends Error {}
class RecordingTokenExpiredError extends Error {}

async function requestToken(config: Config): Promise<PbxToken> {
  const startedAt = Date.now();
  const response = await fetch(config.origin + "/openapi/v1.0/get_token", {
    ...requestOptions(), method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.username, password: config.secret }),
  });
  const data = response.ok ? await response.json() : null;
  if (data?.errcode === 60002) throw new RecordingTokenLimitError();
  if (data?.errcode !== 0 || typeof data.access_token !== "string" || !data.access_token) throw new Error("PBX authentication failed.");
  const lifetime = typeof data.access_token_expire_time === "number" && data.access_token_expire_time > 0
    ? Math.min(data.access_token_expire_time, 1800)
    : 1800;
  return { value: data.access_token, expiresAt: startedAt + lifetime * 1000 - 15_000 };
}

async function getToken(config: Config) {
  const key = tokenKey(config);
  const pending = tokenRequests.get(key);
  if (pending) {
    const token = await pending;
    if (token.expiresAt > Date.now()) return token;
    if (tokenRequests.get(key) === pending) tokenRequests.delete(key);
    return getToken(config);
  }
  const request = requestToken(config);
  tokenRequests.set(key, request);
  try { return await request; }
  catch (error) {
    if (tokenRequests.get(key) === request) tokenRequests.delete(key);
    throw error;
  }
}

export async function withToken<T>(config: Config, operation: (token: string) => Promise<T>) {
  const token = await getToken(config);
  try { return await operation(token.value); }
  catch (error) {
    if (!(error instanceof RecordingTokenExpiredError)) throw error;
    const key = tokenKey(config);
    const cached = tokenRequests.get(key);
    if (cached && await cached.catch(() => null) === token && tokenRequests.get(key) === cached) tokenRequests.delete(key);
    return operation((await getToken(config)).value);
  }
}

export async function pbxQuery(config: Config, path: string, token: string, params: Record<string, string>, body?: Record<string, string>) {
  const url = new URL("/openapi/v1.0/" + path, config.origin);
  url.search = new URLSearchParams({ ...params, access_token: token }).toString();
  const response = await fetch(url, {
    ...requestOptions(),
    ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = response.ok ? await response.json() : null;
  if (data?.errcode === 10005) throw new RecordingAccessError();
  if (data?.errcode === 10004) throw new RecordingTokenExpiredError();
  if (data?.errcode !== 0) throw new Error("PBX request failed.");
  return data;
}


const cdr = z.object({
  uid: z.string().min(1).max(128), call_type: z.literal("Inbound"),
  did_number: z.string().regex(/^\d{6,15}$/), src_trunk: z.string(),
  timestamp: z.number().int().positive().max(4_102_444_800),
  duration: z.number().int().nonnegative().max(86400), record_file: z.unknown().optional(),
  disposition: z.unknown().optional(),
  call_from_number: z.unknown().optional(),
});

export async function listCallRecordings(config: Config, businessId: string, page: number, range: { start?: number; end?: number; readThrough?: number } = {}, view: "recordings" | "missed" = "recordings", includeCustomerNames = true) {
  const cutoff = Date.now() - 30 * 86400_000;
  const snapshots = await adminDb.collection(DID_RECORDING_PERIODS_COLLECTION).where("businessId", "==", businessId).get();
  const periods = snapshots.docs.flatMap(doc => {
    const { did, startedAt, endedAt } = doc.data();
    if (typeof did !== "string" || !/^\d{6,15}$/.test(did) || !(startedAt instanceof Timestamp) ||
        (endedAt !== null && !(endedAt instanceof Timestamp))) return [];
    const start = startedAt.toMillis();
    const end = endedAt?.toMillis() ?? Date.now();
    return end >= cutoff && start < end ? [{ did, start, end }] : [];
  });
  const dids = [...new Set(periods.map(period => period.did))];
  if (!dids.length) return { recordings: [], hasMore: false, hasRecordingHistory: false };
  // Keep calls that predate this business's ownership out of the PBX pages.
  // The per-DID ownership check below still applies across reassignments.
  const searchStart = Math.max(cutoff, range.start ?? cutoff, (range.readThrough ?? cutoff) - 86_400_000,
    periods.reduce((earliest, period) => Math.min(earliest, period.start), Infinity));
  if (searchStart >= Math.min(range.end ?? Infinity, Date.now())) {
    return { recordings: [], hasMore: false, hasRecordingHistory: true };
  }
  const data = await withToken(config, token => pbxQuery(config, "cdr/search", token, {
    did: dids.flatMap(did => config.trunks.map(trunk => did + ":" + trunk)).join(","),
    start_time: String(Math.floor(searchStart / 1000)), sort_by: "time", order_by: "desc",
    ...(range.end !== undefined && { end_time: String(Math.ceil(range.end / 1000) - 1) }),
    page: String(page), page_size: String(pageSize),
    ...(view === "missed" && { status: "NO ANSWER" }),
  }));
  if (!Array.isArray(data.data) && !(data.data == null && data.total_number === 0)) throw new Error("Invalid PBX call list.");
  const seen = new Set<string>();
  const recordings = ((data.data ?? []) as unknown[]).flatMap(row => {
    const parsed = cdr.safeParse(row);
    if (!parsed.success) return [];
    const call = parsed.data;
    const file = recordingFile.safeParse(call.record_file);
    if (view === "missed" ? call.disposition !== "NO ANSWER" : !file.success) return [];
    const startedAt = call.timestamp * 1000;
    if (range.readThrough !== undefined && startedAt + call.duration * 1000 <= range.readThrough) return [];
    // PBX timestamps are only second-precision. Exclude calls touching an ownership boundary.
    if (startedAt < Math.max(cutoff, range.start ?? cutoff) || startedAt >= (range.end ?? Infinity) ||
        !config.trunks.includes(call.src_trunk) ||
        !periods.some(period => period.did === call.did_number && startedAt > period.start &&
          startedAt + (call.duration + 1) * 1000 <= period.end)) return [];
    const number = typeof call.call_from_number === "string" ? call.call_from_number.trim() : "";
    const callerNumber = /^\+?[0-9][0-9 ().-]{0,31}$/.test(number) && /\d$/.test(number) ? number : null;
    const rowKey = view === "recordings" && file.success
      ? createHash("sha256").update(JSON.stringify([call.uid, file.data])).digest("hex")
      : createHash("sha256").update(JSON.stringify([call.uid, call.did_number, startedAt, callerNumber])).digest("hex");
    if (seen.has(rowKey)) return [];
    seen.add(rowKey);
    return [{ id: call.uid, rowKey, did: call.did_number, startedAt, duration: call.duration, callerNumber,
      grant: view === "recordings" && file.success ? issueGrant(config, businessId, file.data) : null }];
  });
  const callerKeys = recordings.map(recording => phoneComparisonKey(recording.callerNumber));
  const customerNames = new Map<string, string | null>();
  if (includeCustomerNames && callerKeys.some(Boolean)) {
    const customers = await adminDb.collection("customers").where("registeredBusinessId", "==", businessId)
      .select("phone", "fullName").get();
    const wantedKeys = new Set(callerKeys);
    for (const doc of customers.docs) {
      const { phone, fullName } = doc.data();
      const key = phoneComparisonKey(phone);
      if (!key || !wantedKeys.has(key)) continue;
      const name = typeof fullName === "string" ? fullName.trim() : "";
      customerNames.set(key, customerNames.has(key) ? null : name || null);
    }
  }
  return {
    recordings: recordings.map((recording, index) => {
      const callerKey = callerKeys[index];
      let callbackGrant: string | null = null;
      if (view === "missed" && includeCustomerNames && callerKey) {
        const payload = Buffer.from(JSON.stringify({
          businessId, callerKey, startedAt: recording.startedAt, expiresAt: Date.now() + 60 * 60_000,
        })).toString("base64url");
        callbackGrant = payload + "." + signCallback(config, payload).toString("base64url");
      }
      return { ...recording, callerKey, callbackGrant, customerName: customerNames.get(callerKey ?? "") ?? null };
    }),
    hasMore: page * pageSize < Number(data.total_number), hasRecordingHistory: true,
  };
}

export async function fetchRecordingAudio(config: Config, file: string) {
  const { data, token } = await withToken(config, async token => ({
    data: await pbxQuery(config, "recording/download", token, { file }), token,
  }));
  if (data.file !== file || typeof data.download_resource_url !== "string") throw new Error("Invalid PBX recording response.");
  const url = new URL(data.download_resource_url, config.origin);
  if (url.origin !== config.origin || url.username || url.password ||
      !/^\/api\/(?:download|downloadattachment)\/[a-zA-Z0-9_.-]+\.(wav|mp3)$/i.test(url.pathname)) throw new Error("Invalid PBX download URL.");
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { ...requestOptions(), signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("PBX recording unavailable.");
  const limit = 64 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw new Error("PBX recording exceeds playback limit.");
  }
  let received = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > limit) controller.error(new Error("PBX recording exceeds playback limit."));
      else controller.enqueue(chunk);
    },
  }));
  return new Response(body, { headers: {
    "Content-Type": url.pathname.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
