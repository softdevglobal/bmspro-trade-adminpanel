import { z } from "zod";

import { OWN_WORDS_MAX, readOwnWords } from "@/lib/ai/email/own-words";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({ text: z.string().max(OWN_WORDS_MAX * 2) }).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

const ERRORS: Record<string, [number, string]> = {
  empty: [400, "Tell Sophie what to do with these emails."],
  too_long: [400, `Keep it under ${OWN_WORDS_MAX} characters.`],
  nothing_to_do: [422, "I couldn't find anything I can do in that. Try something like “move them to a Council folder and remind me a week before the date”."],
  not_configured: [503, "Sophie can't read your own words right now. Pick the actions instead."],
};

/**
 * POST { text }: Sophie turns the owner's own words into steps from the fixed list and reads them
 * back (§5.7). Nothing is saved: the owner confirms, and the steps go through a card or a group
 * answer. Owner only.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: ERRORS.empty[1] }, 400);
    const result = await readOwnWords(body.data.text);
    if (!result.ok) {
      const [status, error] = ERRORS[result.reason] ?? [502, "I couldn't read that just now. Try again, or pick the actions instead."];
      return json({ error }, status);
    }
    return json({ ok: true, ...result.value });
  } catch {
    return json({ error: "I couldn't read that just now. Try again, or pick the actions instead." }, 500);
  }
}
