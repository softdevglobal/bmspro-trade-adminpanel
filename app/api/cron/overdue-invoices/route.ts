import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import { notifyOverdueInvoice } from "@/lib/ai/mcp/tools/overdue-invoice.tools";
import { adminDb } from "@/lib/firebase/admin";
import { INVOICE_COLLECTION } from "@/lib/invoices/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // Include the next UTC date so businesses ahead of UTC are covered.
  // The reminder tool rechecks each invoice in its business timezone.
  const latestDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const invoices = adminDb.collection(INVOICE_COLLECTION)
    .where("dueDate", "<", latestDate)
    .select("status", "businessId");
  let checked = 0;
  let sent = 0;
  let unconfirmed = 0;
  const pending: Promise<void>[] = [];

  try {
    // stream() is declared as NodeJS.ReadableStream (string | Buffer), but it emits snapshots.
    for await (const invoice of invoices.stream() as AsyncIterable<QueryDocumentSnapshot>) {
      const data = invoice.data();
      if (data.status !== "sent" || typeof data.businessId !== "string" || !data.businessId) continue;
      checked += 1;
      pending.push(notifyOverdueInvoice({ businessId: data.businessId }, invoice.id)
        .then((result) => {
          for (const status of [result.customer, result.owner]) {
            if (status === "SENT") sent += 1;
            if (status === "UNCONFIRMED") unconfirmed += 1;
          }
        })
        .catch(() => {
          unconfirmed += 1;
          console.error("[cron/overdue-invoices] Reminder failed", { invoiceId: invoice.id });
        }));
      if (pending.length >= 10) await Promise.all(pending.splice(0));
    }
    await Promise.all(pending);
    return Response.json({ ok: true, checked, sent, unconfirmed });
  } catch {
    await Promise.all(pending);
    console.error("[cron/overdue-invoices] Invoice scan failed");
    return Response.json({ ok: false, checked, sent, unconfirmed }, { status: 500 });
  }
}
