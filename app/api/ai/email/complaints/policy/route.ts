import { z } from "zod";

import {
  approveReturnVisitPolicy, clearCompensationGuide, getPolicies, saveCompensationGuide, saveReturnVisitPolicy, withdrawReturnVisitPolicy,
} from "@/lib/ai/email/complaints/policies";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

const putSchema = z.object({
  returnVisit: z.unknown().optional(),
  compensation: z.array(z.unknown()).max(5).optional(),
}).strict().refine((body) => body.returnVisit !== undefined || body.compensation !== undefined);

const patchSchema = z.discriminatedUnion("action", [
  /** Approves the exact version the owner was shown. Only in the app, never by voice (§10.10). */
  z.object({ action: z.literal("approve"), version: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("withdraw") }).strict(),
  z.object({ action: z.literal("clear_compensation") }).strict(),
]);

/** GET the owner's return-visit rule and compensation guide (§10.10). Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    return json({ available: true, ...(await getPolicies(adminDb, auth.businessId)) });
  } catch {
    return json({ error: "Could not load your complaint settings." }, 500);
  }
}

/** PUT a new version of the rule (not used until approved) and/or the guide (only ever a proposal). */
export async function PUT(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = putSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Enter a return-visit rule or a compensation guide." }, 400);
    if (body.data.returnVisit !== undefined) {
      const saved = await saveReturnVisitPolicy(adminDb, { businessId: auth.businessId, policy: body.data.returnVisit, actorUid: auth.uid });
      if (!saved.ok) return json({ error: saved.error }, saved.status);
    }
    if (body.data.compensation !== undefined) {
      const saved = await saveCompensationGuide(adminDb, { businessId: auth.businessId, entries: body.data.compensation, actorUid: auth.uid });
      if (!saved.ok) return json({ error: saved.error }, saved.status);
    }
    return json({ ok: true, ...(await getPolicies(adminDb, auth.businessId)) });
  } catch {
    return json({ error: "Could not save your complaint settings." }, 500);
  }
}

/** PATCH approve or withdraw the rule, or clear the guide. Owner only, in the app. */
export async function PATCH(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = patchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose what to do." }, 400);
    if (body.data.action === "approve") {
      const approved = await approveReturnVisitPolicy(adminDb, { businessId: auth.businessId, version: body.data.version, actorUid: auth.uid });
      if (!approved.ok) return json({ error: approved.error }, approved.status);
    } else if (body.data.action === "withdraw") {
      await withdrawReturnVisitPolicy(adminDb, auth.businessId);
    } else {
      await clearCompensationGuide(adminDb, auth.businessId);
    }
    return json({ ok: true, ...(await getPolicies(adminDb, auth.businessId)) });
  } catch {
    return json({ error: "Could not change your complaint settings." }, 500);
  }
}
