import { runSophieCallbacks } from "@/lib/ai/calls/run-sophie-callbacks";
import { runOverdueInvoiceCalls } from "@/lib/ai/calls/run-overdue-invoice-calls";
import { runScheduledSophieCallbacks } from "@/lib/ai/calls/run-scheduled-callbacks";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const localTest = process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  const [callbacks, invoiceCalls, scheduledCallbacks] = await Promise.all([
    runSophieCallbacks(localTest), runOverdueInvoiceCalls(), runScheduledSophieCallbacks(),
  ]);
  return Response.json({ ...callbacks, invoiceCalls, scheduledCallbacks });
}
