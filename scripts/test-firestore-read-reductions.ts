import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore, Query } from "firebase-admin/firestore";
import { loadDueScheduledCallbacks } from "../lib/ai/calls/due-scheduled-callbacks";
import { getIndexedQuery, isMissingFirestoreIndex } from "../lib/firebase/indexed-query";

type Row = { id: string; status: string; scheduledAt?: unknown };

function fixture(rows: Row[], indexError?: unknown) {
  const reads: number[] = [];
  function query(filters: Array<[string, string, unknown]> = [], ordered = false, limit = Infinity): unknown {
    return {
      where: (field: string, op: string, value: unknown) => query([...filters, [field, op, value]], ordered, limit),
      orderBy: () => query(filters, true, limit),
      limit: (value: number) => query(filters, ordered, value),
      get: async () => {
        if (ordered && indexError) throw indexError;
        let found = rows.filter(row => filters.every(([field, op, value]) => {
          const current = row[field as keyof Row];
          return op === "==" ? current === value : typeof current === "number" && current <= Number(value);
        }));
        if (ordered) found = [...found].sort((a, b) => Number(a.scheduledAt) - Number(b.scheduledAt));
        found = found.slice(0, limit);
        reads.push(found.length);
        return { size: found.length, docs: found.map(row => ({ id: row.id, get: (key: string) => row[key as keyof Row] })) };
      },
    };
  }
  return { db: { collection: () => query() } as unknown as Firestore, reads };
}

test("future callbacks do not hide due work beyond the old 500-document limit", async () => {
  const rows: Row[] = Array.from({ length: 600 }, (_, i) => ({ id: `future-${i}`, status: "SCHEDULED", scheduledAt: 20_000 }));
  rows.push({ id: "cancelled", status: "CANCELLED", scheduledAt: 1 });
  rows.push({ id: "calling", status: "CALLING", scheduledAt: 1 });
  rows.push(...Array.from({ length: 8 }, (_, i) => ({ id: `due-${i}`, status: "SCHEDULED", scheduledAt: 100 - i })));
  const f = fixture(rows);
  const due = await loadDueScheduledCallbacks(f.db, 100);
  assert.deepEqual(due.map(doc => doc.id), ["due-7", "due-6", "due-5", "due-4", "due-3", "due-2"]);
  assert.deepEqual(f.reads, [6]);
});

test("due boundary is inclusive and future retries are excluded", async () => {
  const f = fixture([
    { id: "now", status: "SCHEDULED", scheduledAt: 100 },
    { id: "retry", status: "SCHEDULED", scheduledAt: 101 },
    { id: "missing", status: "SCHEDULED" },
  ]);
  assert.deepEqual((await loadDueScheduledCallbacks(f.db, 100)).map(doc => doc.id), ["now"]);
  assert.deepEqual((await loadDueScheduledCallbacks(f.db, 101)).map(doc => doc.id), ["now", "retry"]);
});

test("missing index keeps existing callbacks working through the compatibility query", async () => {
  const f = fixture([
    { id: "future", status: "SCHEDULED", scheduledAt: 200 },
    { id: "later", status: "SCHEDULED", scheduledAt: 99 },
    { id: "first", status: "SCHEDULED", scheduledAt: 1 },
    { id: "invalid", status: "SCHEDULED", scheduledAt: "1" },
  ], { code: 9, message: "The query requires an index." });
  assert.deepEqual((await loadDueScheduledCallbacks(f.db, 100)).map(doc => doc.id), ["first", "later"]);
  assert.deepEqual(f.reads, [4]);
});

test("permission/network failures never trigger a broad fallback query", async () => {
  for (const error of [{ code: 7, message: "Permission denied" }, { code: 14, message: "Unavailable" }, { code: 9, message: "Other precondition" }]) {
    const f = fixture([], error);
    await assert.rejects(loadDueScheduledCallbacks(f.db, 100), error);
    assert.deepEqual(f.reads, []);
    assert.equal(isMissingFirestoreIndex(error), false);
  }
});

test("inspection query returns scheduled records only, with legacy fallback if index is building", async () => {
  const rows = [
    { id: "scheduled", status: "scheduled" },
    { id: "cancelled", status: "cancelled" },
    { id: "pending", status: "pending" },
  ];
  const f = fixture(rows);
  const base = f.db.collection("requests");
  const result = await getIndexedQuery("test-inspection", base.where("status", "==", "scheduled"), base);
  assert.deepEqual(result.docs.map(doc => doc.id), ["scheduled"]);
  let fallbackCalls = 0;
  const resultWithMissingIndex = await getIndexedQuery("test-inspection",
    { get: async () => { throw { code: 9, message: "Index is building" }; } } as unknown as Query,
    { get: async () => { fallbackCalls++; return result; } } as unknown as Query);
  assert.equal(resultWithMissingIndex, result);
  assert.equal(fallbackCalls, 1);
});

test('owner pending calls are isolated from old workers and share the six-call batch limit',async()=>{
  const previous=process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED;
  try{
    const rows:Row[]=[{id:'customer',status:'SCHEDULED',scheduledAt:9},...Array.from({length:8},(_,i)=>({id:`owner-${i}`,status:'OWNER_SCHEDULED',scheduledAt:i+1}))];
    process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED='false';
    assert.deepEqual((await loadDueScheduledCallbacks(fixture(rows).db,10)).map(d=>d.id),['customer']);
    process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED='true';
    const due=await loadDueScheduledCallbacks(fixture(rows).db,10);assert.equal(due.length,6);assert.deepEqual(due.map(d=>d.id),['owner-0','owner-1','owner-2','owner-3','owner-4','owner-5']);
  }finally{if(previous===undefined)delete process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED;else process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED=previous;}
});

test('number-only calls use their own pending state and the existing due-time index',async()=>{
 const previous=process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED;
 try{
  const rows:Row[]=[{id:'saved',status:'SCHEDULED',scheduledAt:8},{id:'number',status:'OWNER_NUMBER_SCHEDULED',scheduledAt:2},{id:'future-number',status:'OWNER_NUMBER_SCHEDULED',scheduledAt:11}];
  process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED='false';assert.deepEqual((await loadDueScheduledCallbacks(fixture(rows).db,10)).map(doc=>doc.id),['saved']);
  process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED='true';assert.deepEqual((await loadDueScheduledCallbacks(fixture(rows).db,10)).map(doc=>doc.id),['number','saved']);
 }finally{if(previous===undefined)delete process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED;else process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED=previous;}
});
