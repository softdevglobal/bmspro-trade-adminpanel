import { z } from "zod";

import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { addSender, listSenders } from "@/lib/ai/email/senders";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const addSchema = z.object({
  list: z.enum(["private", "blocked"]),
  value: z.string().max(254),
  label: z.string().max(200).nullish(),
  folder: z.string().max(100).nullish(),
}).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** The owner's private and blocked sender lists (masked addresses and labels only). */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    return json({ available: true, ...(await listSenders(adminDb, auth.businessId)) });
  } catch {
    return json({ error: "Could not load the sender lists." }, 500);
  }
}

/** { list: "private" | "blocked", value: address or @domain, label?, folder? }. Owner only. */
export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = addSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Enter a valid sender." }, 400);
    const result = await addSender(adminDb, auth.businessId, { ...body.data, source: "settings" }, auth.uid);
    return result.ok ? json({ entry: result.entry }) : json({ error: result.error }, result.status);
  } catch {
    return json({ error: "Could not save the sender." }, 500);
  }
}
