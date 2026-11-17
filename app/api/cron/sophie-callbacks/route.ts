import { runSophieCallbacks } from "@/lib/ai/calls/run-sophie-callbacks";
import { runOverdueInvoiceCalls } from "@/lib/ai/calls/run-overdue-invoice-calls";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const localTest = process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  const [callbacks, invoiceCalls] = await Promise.all([runSophieCallbacks(localTest), runOverdueInvoiceCalls()]);
  return Response.json({ ...callbacks, invoiceCalls });
}
