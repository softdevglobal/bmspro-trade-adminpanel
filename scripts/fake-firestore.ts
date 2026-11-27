/**
 * In-memory Firestore for unit tests, with only what Sophie's engine and email code use:
 * doc get/create/set, where/orderBy/limit queries, and transactions. Transactions run one at a
 * time and apply their writes at the end, like Firestore's serializable transactions.
 */

import assert from "node:assert/strict";

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

export type Row = Record<string, unknown>;

export const millis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : value);

const DELETE = FieldValue.delete();
const isPlain = (value: unknown): value is Row =>
  !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

/** Like Firestore's set(…, { merge: true }): nested maps merge, FieldValue.delete() removes a field. */
function deepMerge(target: Row, patch: Row): Row {
  const out: Row = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValue && value.isEqual(DELETE)) delete out[key];
    else if (isPlain(value) && isPlain(out[key])) out[key] = deepMerge(out[key] as Row, value);
    else out[key] = value;
  }
  return out;
}

export function fakeFirestore() {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const snapshot = (collection: string, id: string) => {
    const data = table(collection).get(id);
    return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
  };
  const write = (collection: string, id: string, data: Row, options?: { merge?: boolean }) => {
    table(collection).set(id, options?.merge ? deepMerge(table(collection).get(id) ?? {}, data) : { ...data });
  };
  const ref = (collection: string, id: string) => ({
    collection,
    id,
    async get() { return snapshot(collection, id); },
    async create(data: Row) {
      if (table(collection).has(id)) throw Object.assign(new Error("Document already exists"), { code: 6 });
      write(collection, id, data);
    },
    async set(data: Row, options?: { merge?: boolean }) { write(collection, id, data, options); },
    async delete() { table(collection).delete(id); },
  });
  type Ref = ReturnType<typeof ref>;
  type Filter = [field: string, op: string, value: unknown];
  type Order = { field: string; desc: boolean } | null;
  const query = (collection: string, filters: Filter[], order: Order, max: number) => ({
    where: (field: string, op: string, value: unknown) => query(collection, [...filters, [field, op, value]], order, max),
    orderBy: (field: string, direction?: "asc" | "desc") => query(collection, filters, { field, desc: direction === "desc" }, max),
    limit: (n: number) => query(collection, filters, order, n),
    count() {
      const all = query(collection, filters, order, max);
      return { async get() { const { docs } = await all.get(); return { data: () => ({ count: docs.length }) }; } };
    },
    async get() {
      const rows = [...table(collection)].filter(([, row]) => filters.every(([field, op, value]) => {
        // Like Firestore, a dotted name reads into nested maps ("remedy.revisitJobId").
        const left = millis(field.includes(".") ? field.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Row)[key] : undefined), row) : row[field]);
        const right = millis(value);
        if (op === "==") return left === right;
        if (op === "<") return typeof left === "number" && left < (right as number);
        if (op === ">") return typeof left === "number" && left > (right as number);
        throw new Error(`Unsupported operator ${op}`);
      }));
      if (order) {
        const value = (row: Row) => millis(row[order.field]) as number;
        rows.sort(([, a], [, b]) => (order.desc ? value(b) - value(a) : value(a) - value(b)));
      }
      return { docs: rows.slice(0, max).map(([id, row]) => ({ id, ref: ref(collection, id), data: () => ({ ...row }) })) };
    },
  });
  let queue: Promise<unknown> = Promise.resolve();
  const db = {
    batch() {
      const writes: (() => void)[] = [];
      return {
        set: (target: Ref, data: Row, options?: { merge?: boolean }) => { writes.push(() => write(target.collection, target.id, data, options)); },
        delete: (target: Ref) => { writes.push(() => { table(target.collection).delete(target.id); }); },
        async commit() { for (const apply of writes) apply(); },
      };
    },
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
      where: (field: string, op: string, value: unknown) => query(name, [], null, Infinity).where(field, op, value),
    }),
    runTransaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const writes: (() => void)[] = [];
        const tx = {
          get: async (target: Ref) => snapshot(target.collection, target.id),
          update: (target: Ref, patch: Row) => writes.push(() => {
            assert.ok(table(target.collection).has(target.id), "update of a missing document");
            write(target.collection, target.id, patch, { merge: true });
          }),
          set: (target: Ref, data: Row, options?: { merge?: boolean }) =>
            writes.push(() => write(target.collection, target.id, data, options)),
          delete: (target: Ref) => writes.push(() => { table(target.collection).delete(target.id); }),
        };
        const value = await run(tx);
        for (const apply of writes) apply();
        return value;
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
  return { db: db as unknown as Firestore, table };
}
