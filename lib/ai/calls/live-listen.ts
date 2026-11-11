import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { DID_RECORDING_PERIODS_COLLECTION, lookupVoiceDidRoute } from "../data/did-mappings";
import { pbxQuery, recordingConfig, withToken } from "./recordings";

export const liveCallId = z.string().regex(/^\d{10}\.\d{1,20}$/);
const channelId = z.string().regex(/^[A-Za-z0-9/_.-]{1,128}$/);
const inboundMember = z.object({ to: z.string(), from: z.unknown().optional(), trunk_name: z.string(), member_status: z.string() });
const extensionMember = z.object({ number: z.string(), channel_id: channelId, member_status: z.string() });
const pbxCall = z.object({
  call_id: liveCallId,
  members: z.array(z.object({ inbound: z.unknown().optional(), extension: z.unknown().optional() })),
});
const reportedInboundDids = z.object({
  members: z.array(z.object({ inbound: z.object({ to: z.string() }).nullish().catch(null) })),
});

export function liveListenConfig() {
  const bridgeExtension = process.env.YEASTAR_LIVE_LISTEN_BRIDGE_EXTENSION?.trim();
  const config = recordingConfig();
  return config && bridgeExtension && /^\d{2,11}$/.test(bridgeExtension) ? { ...config, bridgeExtension } : null;
}

type Config = NonNullable<ReturnType<typeof liveListenConfig>>;
const answered = (status: string) => status === "ANSWER" || status === "ANSWERED";

export type LiveCallDiagnostic = {
  ownershipPeriods?: number;
  ownedDidSeen?: number;
  rejectedCallMetadata?: number;
  matchingInbound?: number;
  answeredInbound?: number;
  bridgeLegFound?: number;
  eligibleCalls?: number;
};

export async function findLiveSophieCalls(config: Config, businessId: string, callId?: string, diagnostic?: LiveCallDiagnostic) {
  const snapshots = await adminDb.collection(DID_RECORDING_PERIODS_COLLECTION).where("businessId", "==", businessId).get();
  const periods = new Map<string, { startedAt: number; id: string }>();
  for (const doc of snapshots.docs) {
    const { did, startedAt, endedAt } = doc.data();
    if (endedAt !== null || !(startedAt instanceof Timestamp) || typeof did !== "string" || !/^\d{6,15}$/.test(did)) continue;
    if (startedAt.toMillis() > (periods.get(did)?.startedAt ?? 0)) {
      periods.set(did, { startedAt: startedAt.toMillis(), id: doc.id });
    }
  }
  if (diagnostic) Object.assign(diagnostic, {
    ownershipPeriods: periods.size, ownedDidSeen: 0, rejectedCallMetadata: 0,
    matchingInbound: 0, answeredInbound: 0, bridgeLegFound: 0, eligibleCalls: 0,
  });
  if (!periods.size) return [];
  async function matchCall(raw: unknown) {
    const membersInResponse = diagnostic && reportedInboundDids.safeParse(raw);
    const ownsReportedDid = membersInResponse?.success &&
      membersInResponse.data.members.some(member => member.inbound && periods.has(member.inbound.to));
    if (diagnostic && ownsReportedDid) diagnostic.ownedDidSeen = (diagnostic.ownedDidSeen ?? 0) + 1;
    const parsed = pbxCall.safeParse(raw);
    if (!parsed.success || (callId && parsed.data.call_id !== callId)) {
      if (diagnostic && ownsReportedDid) diagnostic.rejectedCallMetadata = (diagnostic.rejectedCallMetadata ?? 0) + 1;
      return null;
    }
    const { call_id: id, members } = parsed.data;
    const inboundLegs = members.filter(member => member.inbound != null);
    const inbound = inboundMember.safeParse(inboundLegs[0]?.inbound);
    if (inboundLegs.length !== 1 || !inbound.success) {
      if (diagnostic && ownsReportedDid) diagnostic.rejectedCallMetadata = (diagnostic.rejectedCallMetadata ?? 0) + 1;
      return null;
    }
    const bridge = members.flatMap(member => {
      const leg = extensionMember.safeParse(member.extension);
      return leg.success && leg.data.number === config.bridgeExtension ? [leg.data] : [];
    });
    const { to: did, from, trunk_name: trunk } = inbound.data;
    const period = periods.get(did);
    // Accept only the timestamp-shaped Yeastar call IDs and exclude calls that
    // started before the active assignment, even if they are still connected.
    const startedAt = Number(id.split(".")[0]) * 1000;
    if (!period || startedAt <= period.startedAt || startedAt > Date.now() || !config.trunks.includes(trunk)) return null;
    const route = await lookupVoiceDidRoute(did);
    if (route.state !== "active" || route.binding.businessId !== businessId || !route.forwardingExtension ||
        period.id !== did + "-" + route.recordingPeriodVersion ||
        route.forwardingExtension === config.bridgeExtension) return null;
    if (diagnostic) {
      diagnostic.matchingInbound = (diagnostic.matchingInbound ?? 0) + 1;
      if (answered(inbound.data.member_status)) diagnostic.answeredInbound = (diagnostic.answeredInbound ?? 0) + 1;
      if (bridge.length === 1) diagnostic.bridgeLegFound = (diagnostic.bridgeLegFound ?? 0) + 1;
    }
    if (bridge.length !== 1 || !answered(inbound.data.member_status) || !answered(bridge[0].member_status)) return null;
    return {
      id, did, startedAt, callerNumber: typeof from === "string" && /^\+?\d{1,15}$/.test(from) ? from : null,
      monitor: route.forwardingExtension, channel: bridge[0].channel_id,
    };
  }

  async function queryMatches(params: Record<string, string>) {
    const result = await withToken(config, token => pbxQuery(config, "call/query", token, params));
    if (result.data == null) return [];
    if (!Array.isArray(result.data)) throw new Error("Invalid PBX live call list.");
    const matches = await Promise.all((result.data as unknown[]).map(matchCall));
    return matches.filter(call => call !== null);
  }

  let eligible = await queryMatches(callId ? { call_id: callId } : { type: "inbound" });
  // The inbound and extension queries can expose different call states.
  // Both responses must independently pass the same ownership checks.
  if (!callId && eligible.length === 0) {
    eligible = await queryMatches({ extension: config.bridgeExtension });
  }
  if (diagnostic) diagnostic.eligibleCalls = eligible.length;
  return eligible;
}

export async function startSophieListening(config: Config, call: { monitor: string; channel: string }) {
  // A monitor request can ring a phone. Do not retry it after submission.
  const token = await withToken(config, async value => value);
  await pbxQuery(config, "call/listen", token, {}, {
    monitor: call.monitor, channel_id: call.channel, type: "listen",
  });
}
