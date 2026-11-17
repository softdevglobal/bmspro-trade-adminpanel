import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { listBusinessCustomers } from "@/lib/customer/server";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";
import { CALL_LOGS_COLLECTION, callConversationHighlights, toCallLogDetail, type CallLogInput } from "@/lib/ai/data/call-logs";
import { formatInPlatformTimeZone, platformTodayIso } from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { resolveReportDate } from "@/lib/ai/owner-call/day-activity";

export const callHistoryId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export async function customerCallHistory(businessId: string, timeZone: string, search?: string, offset = 0, date?: string, time?: string) {
  const term = search?.trim() ?? "";
  if (!term && !date && !time) return { status: "SEARCH_REQUIRED" };
  const collection = adminDb.collection(CALL_LOGS_COLLECTION);
  const scoped = collection.where("businessId", "==", businessId);
  const describe = (id: string, data: Record<string, unknown>, turnOffset?: number) => {
    const call = toCallLogDetail(id, data);
    const highlights = Array.isArray(data.conversationHighlights)
      ? data.conversationHighlights as CallLogInput["transcript"] : callConversationHighlights(call.transcript);
    const turnsPerPage = 40;
    const conversation = turnOffset === undefined ? highlights
      : call.transcript.slice(turnOffset, turnOffset + turnsPerPage)
        .map(turn => ({ ...turn, text: turn.text.slice(0, 500) }));
    return {
      callId: id, date: call.startedAt === null ? null : platformTodayIso(new Date(call.startedAt), timeZone),
      direction: data.callbackAttemptId ? "sophie_callback" : "not_recorded",
      localTime: call.startedAt === null ? null : formatInPlatformTimeZone(call.startedAt, { hour: "numeric", minute: "2-digit" }, timeZone),
      startedAt: call.startedAt, outcome: call.outcome, verifiedToolOutcomes: call.outcomes.filter(outcome => outcome.tool !== "register_customer"),
      nextTurnOffset: turnOffset !== undefined && turnOffset + turnsPerPage < call.transcript.length
        ? turnOffset + turnsPerPage : null,
      conversation, conversationExcerpted: conversation.length < call.transcript.length ||
        conversation.some(turn => call.transcript.some(original => original.atMs === turn.atMs &&
          original.speaker === turn.speaker && original.text.length > turn.text.length)),
    };
  };
  if (callHistoryId.test(term)) {
    const doc = await collection.doc(term).get();
    const data = doc.data();
    if (!data || data.businessId !== businessId || data.answered !== true) return { status: "NO_MATCH" };
    return { status: "OK", timeZone, calls: [describe(doc.id, data, offset)], nextOffset: null };
  }
  const byNumber = /^\+?[\d\s().-]+$/.test(term);
  const customers = term ? await listBusinessCustomers(businessId) : [];
  const key = byNumber ? phoneComparisonKey(term) : null;
  let matches = byNumber && key
    ? customers.filter(customer => phoneComparisonKey(customer.phone) === key)
    : customers.filter(customer => nameKey(customer.fullName).includes(nameKey(term)));
  const exact = matches.filter(customer => nameKey(customer.fullName) === nameKey(term));
  if (!byNumber && exact.length) matches = exact;
  if (!byNumber && matches.length > 1) return { status: "AMBIGUOUS", candidates: matches.slice(0, 8).map(customer => customer.fullName) };
  const callerKey = key ?? phoneComparisonKey(matches[0]?.phone);
  if (date || time) {
    const day = resolveReportDate(date, new Date(), timeZone);
    if (!day.ok) return { status: "INVALID_DATE", error: day.error };
    if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return { status: "INVALID_TIME" };
    const target = zonedDateTimeToUtcMs(day.date, time ?? "00:00", timeZone);
    const tomorrow = new Date(Date.parse(`${day.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const midnight = zonedDateTimeToUtcMs(tomorrow, "00:00", timeZone);
    if (target === null || midnight === null) return { status: "INVALID_TIME" };
    const margin = time ? 30 * 60_000 : 0;
    const snapshot = await scoped.where("startedAt", ">=", Timestamp.fromMillis(target - margin))
      .where("startedAt", "<", Timestamp.fromMillis(time ? target + margin + 1 : midnight))
      .orderBy("startedAt", "desc").get();
    const answered = snapshot.docs.filter(doc => doc.get("answered") === true);
    const matchesCaller = (doc: (typeof answered)[number]) =>
      !!callerKey && (doc.get("callerKey") === callerKey || phoneComparisonKey(doc.get("callerNumber")) === callerKey);
    const verified = answered.filter(matchesCaller);
    const candidates = !term ? answered : verified.length ? verified
      : answered.filter(doc => !phoneComparisonKey(doc.get("callerNumber")) && !doc.get("callerKey"));
    if (time) candidates.sort((a, b) =>
      Math.abs(a.get("startedAt").toMillis() - target) - Math.abs(b.get("startedAt").toMillis() - target));
    return {
      status: candidates.length ? "OK" : "NO_CALLS", callerMatched: verified.length > 0,
      ...(verified.length && matches.length === 1 ? { customerName: matches[0].fullName } : {}),
      date: day.date, timeZone, calls: candidates.slice(offset, offset + 3).map(doc => describe(doc.id, doc.data())),
      nextOffset: offset + 3 < candidates.length ? offset + 3 : null,
    };
  }
  if (!callerKey) return { status: matches.length ? "NO_CUSTOMER_PHONE" : "NO_MATCH" };
  if (!byNumber && customers.some(customer => customer.uid !== matches[0].uid && phoneComparisonKey(customer.phone) === callerKey)) {
    return { status: "SHARED_PHONE" };
  }
  const legacyNumbers = [...new Set([
    callerKey, `0${callerKey}`, `61${callerKey}`, `0061${callerKey}`, `00${callerKey}`,
    term.replace(/\D/g, ""), matches[0]?.phone.replace(/\D/g, "") ?? "",
  ].filter(number => phoneComparisonKey(number) === callerKey))];
  const [current, legacy] = await Promise.all([
    scoped.where("callerKey", "==", callerKey).select("startedAt", "answered").get(),
    scoped.where("callerNumber", "in", legacyNumbers).select("startedAt", "answered").get(),
  ]);
  const hits = [...new Map([...current.docs, ...legacy.docs].map(doc => [doc.id, doc])).values()]
    .filter(doc => doc.get("answered") === true)
    .sort((a, b) => (b.get("startedAt")?.toMillis() ?? 0) - (a.get("startedAt")?.toMillis() ?? 0));
  const pageSize = 3;
  const details = await Promise.all(hits.slice(offset, offset + pageSize).map(hit => hit.ref.get()));
  const calls = details.flatMap(doc => {
    const data = doc.data();
    return data?.businessId === businessId && data.answered === true ? [describe(doc.id, data)] : [];
  });
  return { status: calls.length ? "OK" : "NO_CALLS",
    customerName: matches.length === 1 ? matches[0].fullName : null, sharedPhone: matches.length > 1, timeZone,
    calls, nextOffset: offset + pageSize < hits.length ? offset + pageSize : null };
}
