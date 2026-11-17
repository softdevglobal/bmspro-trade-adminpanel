import "server-only";

import { runSophieCallbacks } from "@/lib/ai/calls/run-sophie-callbacks";
import { runOverdueInvoiceCalls } from "@/lib/ai/calls/run-overdue-invoice-calls";

const intervalMs = 5 * 60_000;
let started = false;

export function startDevSophieCallbackPoller(): void {
  if (started) return;
  started = true;

  async function tick() {
    const startedAt = Date.now();
    try {
      const [result, invoiceCalls] = await Promise.all([runSophieCallbacks(true), runOverdueInvoiceCalls()]);
      if ("dialled" in result && (result.dialled || result.resolved || result.errors)) {
        console.info("[sophie-callbacks] Dev poll result:", result);
      }
      if (invoiceCalls.processed || invoiceCalls.deferred || invoiceCalls.errors) {
        console.info("[sophie-invoice-calls] Dev poll result:", invoiceCalls);
      }
    } catch (error) {
      console.error("[sophie-callbacks] Dev poll failed:", error);
    } finally {
      setTimeout(tick, Math.max(0, intervalMs - (Date.now() - startedAt))).unref();
    }
  }

  setTimeout(tick, 15_000).unref();
}
