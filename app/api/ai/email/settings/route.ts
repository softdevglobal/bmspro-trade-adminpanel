import { z } from "zod";

import { emailActionDeps } from "@/lib/ai/agent/handlers";
import { SAFETY_TEMPLATE_VERSION } from "@/lib/ai/email/safety";
import { styleSuggestion } from "@/lib/ai/email/style-learning";
import { renderReply } from "@/lib/ai/email/templates";
import { checkStyleLine } from "@/lib/ai/email/style";
import { BUILT_IN_EMAIL_KINDS } from "@/lib/ai/email/types";
import {
  canTurnKindOff,
  emailTriageAvailable,
  getEmailSettings,
  updateEmailSettings,
  type EmailSettings,
} from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/** Partial update. Later steps add the style guide, sender lists and folder names here. */
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  summaryHour: z.number().int().min(0).max(23).optional(),
  /** "Stop sorting these" for one type, or back on (§5.1). */
  kindOff: z.object({
    kind: z.union([z.enum(BUILT_IN_EMAIL_KINDS), z.string().regex(/^custom:[a-z0-9_]{1,40}$/)]).refine(canTurnKindOff),
    off: z.boolean(),
  }).strict().optional(),
  /** Approve the safety reply at this exact version, or withdraw it (§10.5). */
  safetyReplyVersion: z.number().int().min(1).nullable().optional(),
  /** Sophie's greeting and sign-off (§8.5). */
  style: z.object({
    greeting: z.string().max(80),
    greetingUnknown: z.string().max(80),
    signOff: z.string().max(80),
  }).strict().optional(),
}).strict().refine((values) => Object.keys(values).length > 0);

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** Settings, plus the exact safety reply wording for the owner to approve. */
const view = (settings: EmailSettings) => ({
  available: true,
  ...settings,
  safetyReply: { version: SAFETY_TEMPLATE_VERSION, approved: settings.safetyReplyVersion === SAFETY_TEMPLATE_VERSION },
});

/** The exact safety reply, with this business's name and phone, for the owner to approve (§10.5). */
async function safetyReplyText(businessId: string, settings: EmailSettings): Promise<string | null> {
  const profile = await emailActionDeps(adminDb).businessProfile(businessId);
  const rendered = renderReply("safety_holding", {
    businessName: profile.name, businessPhone: profile.phone, ownerFirstName: profile.ownerFirstName,
    firstName: null, serviceName: null, suburb: null, originalSubject: "", firstInThread: true,
  }, settings.style);
  return rendered.ok ? rendered.body : null;
}

/** Sophie's email settings for the owner's business. `available: false` while the platform switches are off. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    const settings = await getEmailSettings(adminDb, auth.businessId);
    const [safetyText, suggestion] = await Promise.all([
      safetyReplyText(auth.businessId, settings),
      styleSuggestion(adminDb, auth.businessId, settings.style).catch(() => null),
    ]);
    return json({ ...view(settings), safetyReplyText: safetyText, styleSuggestion: suggestion });
  } catch {
    return json({ error: "Could not load Sophie's email settings." }, 500);
  }
}

/** { enabled?, paused?, summaryHour?, kindOff? }. Owner only. Pause needs no confirmation; it only stops things. */
export async function PATCH(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const patch = patchSchema.safeParse(await request.json().catch(() => null));
    if (!patch.success) return json({ error: "Enter valid email settings." }, 400);
    if (typeof patch.data.safetyReplyVersion === "number" && patch.data.safetyReplyVersion !== SAFETY_TEMPLATE_VERSION) {
      return json({ error: "The safety reply changed since you opened it. Look at it again." }, 409);
    }
    if (patch.data.style) {
      for (const key of ["greeting", "greetingUnknown", "signOff"] as const) {
        const problem = checkStyleLine(key, patch.data.style[key]);
        if (problem) return json({ error: problem, field: key }, 400);
      }
    }
    return json(view(await updateEmailSettings(adminDb, auth.businessId, patch.data, auth.uid)));
  } catch {
    return json({ error: "Could not save Sophie's email settings." }, 500);
  }
}
