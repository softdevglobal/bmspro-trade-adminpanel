import "server-only";

import { callbackState, readCallbackAttempts } from "@/lib/ai/calls/callback-state";
import { CALL_LOGS_COLLECTION, callConversationHighlights, toCallLogDetail } from "@/lib/ai/data/call-logs";
import { adminDb } from "@/lib/firebase/admin";
import { formatInPlatformTimeZone, platformTodayIso } from "@/lib/platform/timezone";

type MissedCall = { callerKey: string | null; did: string; startedAt: number };

export async function missedCallCallbackDetails(businessId: string, calls: MissedCall[], timeZone: string) {
  const keys = [...new Set(calls.flatMap(call => call.callerKey ? [call.callerKey] : []))];
  const snapshots = keys.length ? await adminDb.getAll(...keys.map(key => callbackState(businessId, key))) : [];
  const states = new Map(keys.map((key, index) => [key, snapshots[index].data()]));
  const details = calls.map(call => {
    const state = call.callerKey ? states.get(call.callerKey) : undefined;
    const resolved = typeof state?.through === "number" && call.startedAt <= state.through;
    const episode = typeof state?.episode === "number" ? state.episode : 0;
    const activeEpisode = episode > (state?.through ?? 0) && call.startedAt >= episode;
    const history = readCallbackAttempts(state?.history).filter(attempt =>
      attempt.did === call.did && (attempt.missedAt === call.startedAt ||
        (activeEpisode && attempt.source === "automatic" && attempt.missedAt >= episode && attempt.missedAt <= call.startedAt)));
    const sameEpisode = activeEpisode || state?.episode === call.startedAt || history.some(attempt => attempt.id === state?.attemptId);
    const attempts = sameEpisode && typeof state?.attempts === "number" ? state.attempts : null;
    const nextAt = !resolved && attempts !== null && attempts < 4 && typeof state?.nextAt === "number" ? state.nextAt : null;
    const resolution = resolved && state?.through === call.startedAt ? state.resolution
      : resolved && state?.resolution === "returned_call_answered" && sameEpisode ? state.resolution : null;
    return { resolved, resolution, history, automaticAttempts: attempts, nextAt };
  });
  const answeredIds = [...new Set(details.flatMap(row => row.history.filter(attempt => attempt.status === "ANSWERED").map(attempt => attempt.id)))];
  const logs = new Map<string, { callId: string; date: string; conversation: ReturnType<typeof callConversationHighlights>; verifiedToolOutcomes: ReturnType<typeof toCallLogDetail>["outcomes"] }>();
  for (let offset = 0; offset < answeredIds.length; offset += 30) {
    const matches = await adminDb.collection(CALL_LOGS_COLLECTION).where("businessId", "==", businessId)
      .where("callbackAttemptId", "in", answeredIds.slice(offset, offset + 30)).get();
    for (const doc of matches.docs) {
      const detail = toCallLogDetail(doc.id, doc.data());
      if (!detail.answered || !detail.transcript.some(turn => turn.speaker === "caller")) continue;
      logs.set(doc.get("callbackAttemptId"), {
        callId: doc.id, date: platformTodayIso(new Date(detail.startedAt ?? 0), timeZone),
        conversation: callConversationHighlights(detail.transcript),
        verifiedToolOutcomes: detail.outcomes.filter(outcome => outcome.tool !== "register_customer"),
      });
    }
  }
  const local = (value: number) => formatInPlatformTimeZone(value, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }, timeZone);
  return details.map(({ resolved, resolution, history, automaticAttempts, nextAt }) => ({
    resolved, resolution, automaticAttempts,
    nextRetryWindow: nextAt === null ? null : local(nextAt),
    retryLimitReached: !resolved && automaticAttempts !== null && automaticAttempts >= 4,
    callbackAttempts: history.map(attempt => ({
      when: local(attempt.attemptedAt), source: attempt.source, status: attempt.status,
      callbackConversation: logs.get(attempt.id) ?? null,
    })),
  }));
}
