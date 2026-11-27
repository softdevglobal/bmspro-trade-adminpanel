import { listReplyTemplates } from "@/lib/ai/email/reply-learning";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * GET the replies Sophie noticed you send (§8.1, R2): the ones waiting for your approval, and the
 * ones you approved. Owner only.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    const templates = await listReplyTemplates(adminDb, auth.businessId);
    return json({
      available: true,
      offers: templates.filter((template) => template.status === "offered"),
      approved: templates.filter((template) => template.status === "approved"),
    });
  } catch {
    return json({ error: "Could not load your saved replies." }, 500);
  }
}
