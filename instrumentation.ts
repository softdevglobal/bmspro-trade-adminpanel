/** Starts the schedule-reminder poller during local `next dev` (Vercel cron handles production). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Some local networks advertise IPv6 without a working route to it, which
  // makes gRPC (used by the Firebase Admin SDK) hang or fail with EHOSTUNREACH
  // when DNS returns an AAAA record first. Prefer IPv4 results so Firestore/
  // Auth/Storage calls don't attempt the broken IPv6 path.
  const { setDefaultResultOrder } = await import("node:dns");
  setDefaultResultOrder("ipv4first");

  if (process.env.NODE_ENV !== "development") return;
  if (process.env.SCHEDULE_REMINDER_DEV_POLL === "false") return;

  const { startDevScheduleReminderPoller } = await import(
    "@/lib/scheduling/dev-reminder-poller"
  );
  startDevScheduleReminderPoller();
}
