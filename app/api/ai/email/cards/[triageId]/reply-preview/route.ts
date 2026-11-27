import { z } from "zod";

import { emailActionDeps } from "@/lib/ai/agent/handlers";
import { prepareReply } from "@/lib/ai/email/actions/reply";
import { EMAIL_TRIAGE_COLLECTION } from "@/lib/ai/email/collections";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { REPLY_TEMPLATE_IDS } from "@/lib/ai/email/templates";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  template: z.union([z.enum(REPLY_TEMPLATE_IDS), z.string().regex(/^custom_[0-9a-f]{40}$/)]),
  /** The details on the card's form, when the owner has filled it in. */
  details: z.object({ fullName: z.string().max(120), address: z.object({ suburb: z.string().max(80) }).passthrough() }).passthrough().optional(),
}).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST the exact reply Sophie would send for one card (step 8): the owner reads it before tapping
 * "Do this". Nothing is sent. Owner only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ triageId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose a reply." }, 400);
    const { triageId } = await params;
    if (!/^[0-9a-f]{40}$/.test(triageId)) return json({ error: "Email not found." }, 404);
    const triage = (await adminDb.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId).get()).data();
    if (!triage || triage.businessId !== auth.businessId || triage.precheck === "private") return json({ error: "Email not found." }, 404);
    const message = (await adminDb.collection(EMAIL_MESSAGES_COLLECTION).doc(String(triage.messageId ?? "")).get()).data() ?? null;
    const details = body.data.details
      ? { fullName: body.data.details.fullName, address: { street: "", state: "", postcode: "", suburb: body.data.details.address.suburb }, phone: "", preferredSlots: [], title: "", description: "" }
      : null;
    const { rendered } = await prepareReply({
      deps: emailActionDeps(adminDb),
      businessId: auth.businessId,
      triage,
      message: message && message.businessId === auth.businessId ? message : null,
      decision: {},
    }, body.data.template as Parameters<typeof prepareReply>[1], details);
    if (!rendered.ok) return json({ error: "Add your business name under Settings so Sophie can sign her replies." }, 409);
    return json({ subject: rendered.subject, body: rendered.body });
  } catch {
    return json({ error: "Could not show the reply." }, 500);
  }
}
