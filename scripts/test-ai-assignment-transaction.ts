import assert from "node:assert/strict";
import test, { after } from "node:test";
// @ts-expect-error Runtime supports hooks; repository uses Node 20 typings.
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Keep Firestore and leave data offline while exercising the real transaction and planner.
const directory = mkdtempSync(join(tmpdir(), "advice-assignment-"));
const mock = join(directory, "leave.cjs");
const statusMock = join(directory, "status.cjs");
writeFileSync(mock, "exports.mapLeaveDoc=(id,data)=>({...data,id});");
writeFileSync(statusMock, "exports.isTenantAccessAllowed=(status,active)=>status!=='suspended'&&active!==false;");
after(() => { unlinkSync(mock); unlinkSync(statusMock); rmdirSync(directory); });
registerHooks({ resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
  const normalized = specifier.replaceAll("\\", "/");
  if (specifier === "@/lib/leave/server" || normalized.endsWith("/lib/leave/server.ts") || normalized.endsWith("/lib/leave/server")) return { url: pathToFileURL(mock).href, format: "commonjs", shortCircuit: true };
  if (specifier === "@/lib/onboarding/business-status" || /\/lib\/onboarding\/business-status(?:\.ts)?$/.test(normalized)) return { url: pathToFileURL(statusMock).href, format: "commonjs", shortCircuit: true };
  return next(specifier, context);
} });

type Row = Record<string, unknown>;
type Ref = { collection: string; id?: string };
function fixture() {
  const state = { authority: true, permitted: true, saved: null as Row | null, serviceReads: 0, updates: 0,
    service: { businessId: "business-a", isActive: true, staffIds: ["inspector-a"] } as Row };
  const member = () => ({ role: "staff", businessId: "business-a", status: "active", isActive: true, canget_qutaion: state.permitted,
    fullName: "Inspector", availability: ["Weekdays", "Saturdays", "Sundays"] });
  const snapshot = (id: string, data: Row) => ({ id, data: () => data, updateTime: { isEqual: () => true } });
  const tx = {
    async get(ref: Ref) {
      if (ref.collection === "services") { state.serviceReads++; return snapshot(ref.id!, state.service); }
      if (ref.id !== undefined) {
        if (ref.collection === "businesses") return snapshot(ref.id, { isActive: true, status: "active", sophieBookingAuthority: state.authority, timezone: "Australia/Melbourne" });
        if (ref.collection === "requests") return snapshot(ref.id, state.saved || {});
        return snapshot(ref.id, {});
      }
      return { docs: ref.collection === "users" ? [snapshot("inspector-a", member())]
        : ref.collection === "requests" && state.saved ? [snapshot("request-a", state.saved)] : [] };
    },
    set() {},
    create(_ref: Ref, value: Row) { assert.equal(state.saved, null); state.saved = value; },
    update(_ref: Ref, value: Row) { state.updates++; state.saved = { ...state.saved, ...value }; },
  };
  const db = {
    collection(collection: string) { return { doc(id: string) { assert.equal(typeof id, "string"); assert.ok(id); return { collection, id }; }, where() { return { collection }; } }; },
    async runTransaction(run: (value: typeof tx) => Promise<unknown>) { return run(tx); },
  };
  const request = { id: "request-a", businessId: "business-a", requestType: "custom_quote", serviceId: null,
    customRequest: { title: "Assess a fault", description: "Need advice" }, status: "pending", preferredSlots: [{ date: "2099-01-05", timeRange: "morning" }] };
  return { db, state, request, ref: { collection: "requests", id: "request-a" } };
}

test("advice assignment commits a scheduled inspector without reading a fabricated service", async () => {
  const { createAiAssignedInspection } = await import("../lib/team/ai-assignment-server");
  const f = fixture();
  await createAiAssignedInspection(f.db as unknown as Parameters<typeof createAiAssignedInspection>[0], f.ref as unknown as Parameters<typeof createAiAssignedInspection>[1], f.request, "sophie", true);
  assert.equal(f.state.serviceReads, 0); assert.equal(f.state.saved?.status, "scheduled");
  assert.equal(f.state.saved?.serviceId, null); assert.deepEqual(f.state.saved?.customRequest, f.request.customRequest);
  assert.equal((f.state.saved?.assignedTo as Row).uid, "inspector-a");
  assert.deepEqual(f.state.saved?.scheduledSlot, f.request.preferredSlots[0]);
});

test("transaction rechecks owner authority and staff advice permission", async () => {
  const { createAiAssignedInspection } = await import("../lib/team/ai-assignment-server");
  for (const changed of ["authority", "permitted"] as const) {
    const f = fixture(); f.state[changed] = false;
    await createAiAssignedInspection(f.db as unknown as Parameters<typeof createAiAssignedInspection>[0], f.ref as unknown as Parameters<typeof createAiAssignedInspection>[1], f.request, "sophie", true);
    assert.equal(f.state.saved?.status, "pending"); assert.equal(f.state.serviceReads, 0);
    if (changed === "permitted") assert.equal(f.state.saved?.assignedTo, null);
  }
});

test("owner adjustment of an advice inspection rechecks eligibility and does not load a null service", async () => {
  const { createAiAssignedInspection, commitAiInspectionApproval } = await import("../lib/team/ai-assignment-server");
  const f = fixture();
  const db = f.db as unknown as Parameters<typeof createAiAssignedInspection>[0];
  const ref = f.ref as unknown as Parameters<typeof createAiAssignedInspection>[1];
  await createAiAssignedInspection(db, ref, f.request, "sophie", true);
  const version = {} as Parameters<typeof commitAiInspectionApproval>[2];
  const updates = { status: "scheduled", scheduledSlot: f.request.preferredSlots[0], scheduledStartTime: "09:00", scheduledEndTime: "10:00" };
  assert.equal(await commitAiInspectionApproval(db, ref, version, updates), true);
  f.state.permitted = false;
  assert.equal(await commitAiInspectionApproval(db, ref, version, updates), false);
  assert.equal(f.state.updates, 1); assert.equal(f.state.serviceReads, 0);
});

test("existing-service scheduling still validates ownership and cannot cross business boundaries", async () => {
  const { createAiAssignedInspection } = await import("../lib/team/ai-assignment-server");
  const f = fixture(); f.state.permitted = false;
  const request = { ...f.request, requestType: "existing_service", serviceId: "service-a", customRequest: null };
  await createAiAssignedInspection(f.db as unknown as Parameters<typeof createAiAssignedInspection>[0], f.ref as unknown as Parameters<typeof createAiAssignedInspection>[1], request, "sophie", true);
  assert.equal(f.state.saved?.status, "scheduled"); assert.equal(f.state.serviceReads, 1);
  const foreign = fixture(); foreign.state.service.businessId = "business-b";
  await assert.rejects(createAiAssignedInspection(foreign.db as unknown as Parameters<typeof createAiAssignedInspection>[0], foreign.ref as unknown as Parameters<typeof createAiAssignedInspection>[1], request, "sophie", true));
  assert.equal(foreign.state.saved, null);
});
