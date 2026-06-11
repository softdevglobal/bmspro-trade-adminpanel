/**
 * CC direct chat — agent marks thread as reviewed.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * PATCH http://localhost:3000/api/chat/cc-direct/agent/{chatId}/reviewed
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "reviewed": true }
 *
 * Success — 200:  { "ok": true }
 * Firestore:      chatsReviewed, chatsReviewedAt, chatsReviewedByUid on room doc
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { markCcChatReviewed } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * PATCH /api/chat/cc-direct/agent/:chatId/reviewed
 * Agent workflow flag — marks the CC thread as reviewed in the inbox.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { chatId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return chatJson({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const reviewed: boolean =
    !!(
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { reviewed?: unknown }).reviewed === true
    );

  try {
    await markCcChatReviewed(auth.uid, chatId, reviewed);
    return chatJson({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not update review.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
