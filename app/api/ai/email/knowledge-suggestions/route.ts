import { after } from "next/server";
import { z } from "zod";

import { suggestKnowledgeDraft } from "@/lib/ai/email/knowledge-suggestions";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({ fact: z.string().max(600) }).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST a business fact from the owner's own words (§7.3) as a knowledge DRAFT. It is not used until
 * the owner publishes it on the AI knowledge page. Owner only.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Write the fact in a sentence." }, 400);
    const result = await suggestKnowledgeDraft(adminDb, { businessId: auth.businessId, uid: auth.uid, fact: body.data.fact });
    if (!result.ok) return json({ error: result.error }, result.status);
    if (!result.existing) {
      // Same indexing as any knowledge entry, so it can be found once the owner publishes it.
      after(async () => {
        try { await (await import("@/lib/ai/rag/ingest")).indexKnowledgeSource(result.id); }
        catch { console.error("[ai/email/knowledge] Indexing failed"); }
      });
    }
    return json({ ok: true, id: result.id, existing: result.existing, needsReview: result.flags.length > 0 }, result.existing ? 200 : 201);
  } catch {
    return json({ error: "Could not save that." }, 500);
  }
}
