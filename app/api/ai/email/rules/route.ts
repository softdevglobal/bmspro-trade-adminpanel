import { listRules, ruleView } from "@/lib/ai/email/rules";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * GET the rules Sophie learned for the owner's business (§5, §16): offers waiting for an answer
 * first, then the rest. Owner only.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const rules = (await listRules(adminDb, auth.businessId)).map(ruleView);
    return json({
      offers: rules.filter((rule) => rule.status === "offered" && rule.level !== "off"),
      rules: rules.filter((rule) => rule.status !== "offered" || rule.level === "off"),
    });
  } catch {
    return json({ error: "Could not load Sophie's email rules." }, 500);
  }
}
