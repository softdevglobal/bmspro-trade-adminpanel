/** Starts local pollers during `next dev` (Vercel cron handles production). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.SOPHIE_CALLBACK_DEV_POLL === "true" && process.env.AI_SOPHIE_CALLBACK_ENABLED === "true") {
    const { startDevSophieCallbackPoller } = await import("@/lib/ai/calls/dev-callback-poller");
    startDevSophieCallbackPoller();
  }
  if (process.env.SCHEDULE_REMINDER_DEV_POLL === "false") return;

  const { startDevScheduleReminderPoller } = await import(
    "@/lib/scheduling/dev-reminder-poller"
  );
  startDevScheduleReminderPoller();

  const { startDevCareplusOutboxPoller } = await import(
    "@/lib/integrations/careplus/dev-poller"
  );
  startDevCareplusOutboxPoller();
}
