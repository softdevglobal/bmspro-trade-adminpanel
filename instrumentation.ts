/** Starts the schedule-reminder poller during local `next dev` (Vercel cron handles production). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.SCHEDULE_REMINDER_DEV_POLL === "false") return;

  const { startDevScheduleReminderPoller } = await import(
    "@/lib/scheduling/dev-reminder-poller"
  );
  startDevScheduleReminderPoller();
}
