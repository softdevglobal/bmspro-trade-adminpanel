import "server-only";

import { runSophieCallbacks } from "@/lib/ai/calls/run-sophie-callbacks";
import { runOverdueInvoiceCalls } from "@/lib/ai/calls/run-overdue-invoice-calls";
import { runScheduledSophieCallbacks } from "@/lib/ai/calls/run-scheduled-callbacks";

const missedCallPollMs = 15_000;
const otherCallPollMs = 60_000;
let started = false;

export function startDevSophieCallbackPoller(): void {
  if (started) return;
  started = true;
  console.info("[sophie-callbacks] Local missed-call worker started; polling every 15 seconds.");
  console.info("[sophie-scheduled-callbacks] Local scheduled-call worker started; polling every minute.");

  async function pollMissedCalls() {
    const startedAt = Date.now();
    try {
      const result = await runSophieCallbacks(true);
      if ("dialled" in result && (result.dialled || result.resolved || result.errors || result.deferred)) {
        console.info("[sophie-callbacks] Dev poll result:", result);
      }
    } catch (error) {
      console.error("[sophie-callbacks] Dev poll failed:", error);
    } finally {
      setTimeout(pollMissedCalls, Math.max(0, missedCallPollMs - (Date.now() - startedAt))).unref();
    }
  }

  async function pollInvoiceCalls() {
    const startedAt = Date.now();
    try {
      const invoiceCalls = await runOverdueInvoiceCalls();
      if (invoiceCalls.processed || invoiceCalls.deferred || invoiceCalls.errors) {
        console.info("[sophie-invoice-calls] Dev poll result:", invoiceCalls);
      }
    } catch (error) {
      console.error("[sophie-invoice-calls] Dev poll failed:", error);
    } finally {
      setTimeout(pollInvoiceCalls, Math.max(0, otherCallPollMs - (Date.now() - startedAt))).unref();
    }
  }

  async function pollScheduledCalls() {
    const startedAt = Date.now();
    try {
      const scheduledCallbacks = await runScheduledSophieCallbacks({ busyRetryMs: otherCallPollMs });
      if (scheduledCallbacks.processed || scheduledCallbacks.deferred || scheduledCallbacks.skipped || scheduledCallbacks.errors) {
        console.info("[sophie-scheduled-callbacks] Dev poll result:", scheduledCallbacks);
      }
    } catch (error) {
      console.error("[sophie-scheduled-callbacks] Dev poll failed:", error);
    } finally {
      setTimeout(pollScheduledCalls, Math.max(0, otherCallPollMs - (Date.now() - startedAt))).unref();
    }
  }

  setTimeout(pollMissedCalls, missedCallPollMs).unref();
  setTimeout(pollInvoiceCalls, 15_000).unref();
  setTimeout(pollScheduledCalls, 15_000).unref();
}
