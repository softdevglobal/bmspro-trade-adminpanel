/**
 * Support chat — agent claims a waiting conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/claim
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "conversation": { "status": "connected", "agentId", ... } }
 *
 * Errors:
 *   { "ok": false, "error": "Conversation is not available to claim." }  400
 *
 * Effect: status waiting → connected; system message sent to owner
 * Do this after: GET /api/chat/conversations/agent (copy conversationId from queue)
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { agentClaimConversation } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/:conversationId/claim
 * Assigns the thread to the calling agent and notifies the workshop owner.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;

  try {
    const conversation = await agentClaimConversation(auth.uid, conversationId);
    return chatJson({ ok: true, conversation });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not claim conversation.";
    return chatJson({ ok: false, error: msg }, { status: 400 });
  }
}
