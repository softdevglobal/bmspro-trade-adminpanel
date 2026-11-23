import "server-only";

import { runScheduleReminders } from "@/lib/scheduling/schedule-reminders";

const POLL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 15_000;

let started = false;

/** Polls every 5 minutes while `next dev` is running. */
export function startDevScheduleReminderPoller(): void {
  if (started) return;
  started = true;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runScheduleReminders();
      if (result.due > 0 || result.sent > 0) {
        console.info("[schedule-reminders] Dev poll result:", result);
      }
    } catch (error) {
      console.error("[schedule-reminders] Dev poll failed:", error);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, POLL_MS);
}
