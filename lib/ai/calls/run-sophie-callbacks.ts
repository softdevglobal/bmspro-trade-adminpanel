import "server-only";

import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { logFirestoreDocuments } from "@/lib/firebase/indexed-query";
import { DID_MAPPINGS_COLLECTION, lookupVoiceDidRoute } from "@/lib/ai/data/did-mappings";
import { callbackResultStatus, callbackState, resolveCallback, saveCallbackAttempt, type CallbackAttempt } from "@/lib/ai/calls/callback-state";
import { normalizeCallbackMobile } from "@/lib/ai/calls/callback-number";
import { listCallRecordings, recordingConfig } from "@/lib/ai/calls/recordings";
import { requestSophieCallback } from "@/lib/ai/calls/request-callback";
import { isCustomerCallOptedOut } from "@/lib/ai/calls/call-preferences";
import { isWithinSophieCallingHours } from "@/lib/ai/calls/calling-hours";

const retryInterval = 90 * 60_000;
const localRetryInterval = 1 * 60_000;
const attemptLease = 60_000;
const maxAttempts = 4;
const discoveryWindow = 24 * 60 * 60_000;

export async function runSophieCallbacks(localTest = false) {
  const config = recordingConfig();
  if (process.env.AI_SOPHIE_CALLBACK_ENABLED !== "true" || !config) {
    return { enabled: false } as const;
  }
  const started = Date.now();
  function retryDueAt(state: { nextAt?: number; leaseUntil?: number }) {
    const nextAt = state.nextAt ?? 0;
    // The lease is written at the start of each attempt. A cleared lease
    // indicates bridge backoff, so retain its existing due time.
    if (!localTest || !state.leaseUntil) return nextAt;
    return Math.min(nextAt, state.leaseUntil - attemptLease + localRetryInterval);
  }
  const counts = { dialled: 0, resolved: 0, errors: 0, deferred: 0 };
  const mappings = await adminDb.collection(DID_MAPPINGS_COLLECTION)
    .where("isActive", "==", true).where("callback.automatic", "==", true).get();
  logFirestoreDocuments("missed-callback-mappings", mappings.size);
  const businesses = new Map<string, { did: string; since: number }[]>();
  for (const doc of mappings.docs) {
    const since = doc.get("autoCallbackSince")?.toMillis?.();
    const businessId = doc.get("businessId");
    if (typeof since !== "number" || typeof businessId !== "string") continue;
    const routes = businesses.get(businessId) ?? [];
    routes.push({ did: doc.id, since });
    businesses.set(businessId, routes);
  }

  async function history(businessId: string, view: "missed" | "answered", start: number, end = started) {
    const rows = [];
    for (let page = 1; page <= 20 && Date.now() - started < 220_000; page++) {
      const result = await listCallRecordings(config!, businessId, page, { start, end }, view, false);
      rows.push(...result.recordings);
      if (!result.hasMore) return rows;
    }
    throw new Error("Could not verify complete call history.");
  }

  for (const [businessId, routes] of businesses) {
    if (Date.now() - started > 220_000) break;
    try {
      const start = Math.max(started - discoveryWindow, Math.min(...routes.map(route => route.since)));
      const misses = await history(businessId, "missed", start);
      if (!misses.length) continue;
      const answers = await history(businessId, "answered", start);
      const answered = new Map<string, number>();
      for (const row of answers) {
        if (!row.callerKey) continue;
        answered.set(row.callerKey, Math.max(answered.get(row.callerKey) ?? 0, row.startedAt));
      }
      const callers = new Map<string, (typeof misses)[number]>();
      for (const row of misses) {
        const route = routes.find(item => item.did === row.did && row.startedAt > item.since);
        if (!route || !row.callerKey || !row.callerNumber) continue;
        const previous = callers.get(row.callerKey);
        if (!previous || previous.startedAt < row.startedAt) callers.set(row.callerKey, row);
      }
      for (const [callerKey, row] of [...callers].sort((a, b) => a[1].startedAt - b[1].startedAt)) {
        if (Date.now() - started > 220_000) break;
        const ref = callbackState(businessId, callerKey);
        const known = (await ref.get()).data();
        logFirestoreDocuments("missed-callback-state-lookup", 1);
        // Resolved episodes need no opt-out lookup or repeat resolution transaction.
        // Read fresh each run so manual completion and new episodes remain visible.
        if (row.startedAt <= (known?.through ?? 0)) continue;
        const answer = answered.get(callerKey) ?? 0;
        if (answer > row.startedAt) {
          // Count only real resolutions: the same answered caller stays in the
          // 24h history window and would otherwise be "resolved" every poll.
          if (await resolveCallback(businessId, callerKey, answer, "returned_call_answered")) counts.resolved++;
          continue;
        }
        const number = normalizeCallbackMobile(row.callerNumber ?? "");
        if (!number || number === row.did) continue;
        if (known?.episode > Math.max(answer, known?.through ?? 0) &&
            (retryDueAt(known ?? {}) > Date.now() || known?.attempts >= maxAttempts)) continue;
        if (await isCustomerCallOptedOut(businessId, number)) {
          await resolveCallback(businessId, callerKey, row.startedAt, "customer_opt_out");
          continue;
        }
        const route = await lookupVoiceDidRoute(row.did);
        if (route.state !== "active" || route.binding.businessId !== businessId) continue;
        if (route.business.sophieMissedCallbacksEnabled !== true) {
          await resolveCallback(businessId, callerKey, row.startedAt, "automation_disabled");
          continue;
        }
        const ownerEnabledAt = typeof route.business.sophieMissedCallbacksEnabledAt?.toMillis === "function"
          ? route.business.sophieMissedCallbacksEnabledAt.toMillis() : 0;
        if (row.startedAt <= ownerEnabledAt) {
          await resolveCallback(businessId, callerKey, row.startedAt, "automation_disabled");
          continue;
        }
        if (!route.callback?.automatic || !route.autoCallbackSince || row.startedAt <= route.autoCallbackSince) continue;
        if (!isWithinSophieCallingHours(Date.now(), route.business.timezone ?? "Australia/Melbourne", route.business.sophieCallingHours)) continue;
        const recentAnswer = (await history(businessId, "answered", started, Date.now()))
          .reduce((latest, call) => call.callerKey === callerKey ? Math.max(latest, call.startedAt) : latest, 0);
        if (recentAnswer > row.startedAt) {
          if (await resolveCallback(businessId, callerKey, recentAnswer, "returned_call_answered")) counts.resolved++;
          continue;
        }
        const attempt = await adminDb.runTransaction(async tx => {
          const state = (await tx.get(ref)).data();
          const through = Math.max(answer, state?.through ?? 0);
          if (row.startedAt <= through || Math.max(state?.leaseUntil ?? 0, state?.manualLeaseUntil ?? 0) > Date.now()) return null;
          const sameEpisode = (state?.episode ?? 0) > through;
          const attempts = sameEpisode ? state!.attempts as number : 0;
          if (attempts >= maxAttempts || (sameEpisode && retryDueAt(state!) > Date.now())) return null;
          const episode = sameEpisode ? state!.episode as number : row.startedAt;
          const id = createHash("sha256").update(JSON.stringify([businessId, callerKey, episode, attempts + 1])).digest("hex");
          const now = Date.now();
          tx.set(ref, { through, episode, attempts: attempts + 1, attemptId: id,
            nextAt: now + retryInterval, leaseUntil: now + attemptLease }, { merge: true });
          return { id, attempts };
        });
        if (!attempt) continue;
        const entry: CallbackAttempt = { id: attempt.id, did: row.did, missedAt: row.startedAt,
          attemptedAt: Date.now(), source: "automatic", status: "REQUESTED" };
        await saveCallbackAttempt(businessId, callerKey, entry);
        let status: CallbackAttempt["status"] = "UNKNOWN";
        try {
          const response = await requestSophieCallback({ id: attempt.id, did: row.did, businessId, number, automatic: true });
          if (response.status === 429) {
            status = "DEFERRED";
            counts.deferred++;
            const retryAt = Date.now() + (localTest ? localRetryInterval : 5 * 60_000);
            await adminDb.runTransaction(async tx => {
              if ((await tx.get(ref)).get("attemptId") === attempt.id) {
                tx.update(ref, { attempts: attempt.attempts, nextAt: retryAt, leaseUntil: 0 });
              }
            });
            continue;
          }
          const result = response.ok ? await response.json() : null;
          status = response.ok ? callbackResultStatus(result?.status) : response.status < 500 ? "FAILED" : "UNKNOWN";
          counts.dialled++;
          if (result?.status === "ANSWERED") await resolveCallback(businessId, callerKey, row.startedAt, "sophie_callback_answered");
          else if (result?.status !== "NO_ANSWER") counts.errors++;
        } catch {
          counts.errors++;
        } finally {
          await saveCallbackAttempt(businessId, callerKey, { ...entry, status });
        }
      }
    } catch {
      counts.errors++;
      console.error("[sophie-callbacks] Could not process callback queue", { businessId });
    }
  }

  return counts;
}
