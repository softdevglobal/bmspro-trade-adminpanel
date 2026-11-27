/** Starts local pollers during `next dev` (Vercel cron handles production). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerLocalPollers } = await import("./lib/instrumentation-node");
    await registerLocalPollers();
  }
}
