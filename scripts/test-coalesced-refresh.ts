import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedRefresh } from "../lib/data/coalesced-refresh";

test("notification bursts merge and events during a fetch get one trailing refresh", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let finish: () => void = () => {};
  const refresh = createCoalescedRefresh(async () => {
    calls++;
    if (calls === 1) await new Promise<void>(resolve => { finish = resolve; });
  });
  refresh.request(); refresh.request(); refresh.request();
  context.mock.timers.tick(250);
  assert.equal(calls, 1);
  refresh.request(); refresh.request();
  context.mock.timers.tick(1000);
  assert.equal(calls, 1);
  finish();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  context.mock.timers.tick(250);
  assert.equal(calls, 2);
  refresh.dispose();
});

test("disposing a hidden/unmounted provider cancels pending work", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const refresh = createCoalescedRefresh(async () => { calls++; });
  refresh.request(); refresh.dispose(); refresh.request();
  context.mock.timers.tick(1000);
  assert.equal(calls, 0);
});
