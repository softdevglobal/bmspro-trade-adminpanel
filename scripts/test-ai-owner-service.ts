import assert from "node:assert/strict"; // assertions
import test from "node:test"; // Node's test runner, like the other scripts/test-ai-*.ts
import {
  checkCreate, checkOwnerReply, OWNER_SERVICE_LIMITS as L, OWNER_SERVICE_PARAMETERS, OWNER_SERVICE_TOOL_NAMES,
  ownerServiceEnabled, prepareServiceInput,
} from "../lib/ai/owner-call/owner-service";

const now = 1_000_000_000; // fixed clock for repeatable tests
const old = (ms: number) => ({ createdAt: now - ms }); // a draft prepared `ms` ago

test("flag is off unless set to true", () => {
  assert.equal(ownerServiceEnabled({}), false);
  assert.equal(ownerServiceEnabled({ AI_OWNER_VOICE_SERVICE_ENABLED: "true" }), true);
});

test("create needs a draft, a yes, and time to read it back", () => {
  assert.equal(checkCreate(null, true, now).ok, false); // nothing prepared
  assert.equal(checkCreate(old(10_000), false, now).ok, false); // model did not confirm
  assert.equal(checkCreate(old(1_000), true, now).ok, false); // too fast: no read-back
  assert.equal(checkCreate(old(L.draftTtlMs + 1), true, now).ok, false); // expired
  assert.equal(checkCreate(old(10_000), true, now).ok, true); // valid
});

test("browser gate: the owner must reply after the read-back and not say no", () => {
  const replied = { prepared: true, ownerTurnsSinceShown: 1, latestOwnerReply: "yes, add it" };
  assert.equal(checkOwnerReply(replied).ok, true); // clear yes
  assert.equal(checkOwnerReply({ ...replied, prepared: false }).ok, false); // nothing prepared this session
  assert.equal(checkOwnerReply({ ...replied, ownerTurnsSinceShown: 0 }).ok, false); // model skipped the owner's answer
  assert.equal(checkOwnerReply({ ...replied, latestOwnerReply: "no, wait" }).ok, false); // owner declined
  assert.equal(checkOwnerReply({ ...replied, latestOwnerReply: "hold on" }).ok, false); // owner paused
  assert.equal(checkOwnerReply({ ...replied, latestOwnerReply: "yes, no changes" }).ok, true); // leading yes wins
  assert.equal(checkOwnerReply({ ...replied, latestOwnerReply: null }).ok, true); // transcription failed: a reply alone passes, as for knowledge drafts
});

test("prepare input rules", () => {
  assert.ok(prepareServiceInput.safeParse({ name: "Gutter cleaning", durationMin: 120, tasks: [{ title: "Clear gutters" }] }).success);
  assert.equal(prepareServiceInput.safeParse({ name: "Gutter cleaning", durationMin: 5, tasks: [{ title: "x" }] }).success, false); // duration too short
  assert.equal(prepareServiceInput.safeParse({ name: "Gutter cleaning", durationMin: 60, tasks: [] }).success, false); // no steps
  assert.equal(prepareServiceInput.safeParse({ name: "Gutter cleaning", durationMin: 60, tasks: [{ title: "x" }], price: 99 }).success, false); // extra field
});

test("schemas match the tool names", () => {
  assert.deepEqual(Object.keys(OWNER_SERVICE_PARAMETERS).sort(), [...OWNER_SERVICE_TOOL_NAMES].sort());
  assert.deepEqual(OWNER_SERVICE_PARAMETERS.create_service.required, ["confirmed"]);
});
