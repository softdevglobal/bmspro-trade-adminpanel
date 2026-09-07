import "server-only";

import { processCareplusOutbox } from "@/lib/integrations/careplus/outbox";

const POLL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 20_000;

let started = false;

export function startDevCareplusOutboxPoller(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const result = await processCareplusOutbox();
      if (result.sent > 0 || result.failed > 0 || result.retried > 0) {
        console.info("[careplus-outbox] Dev poll result:", result);
      }
    } catch (error) {
      console.error("[careplus-outbox] Dev poll failed", error);
    }
  };

  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, POLL_MS);
}
