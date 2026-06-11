/**
 * Support chat — agent marks customer messages as read.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/read
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:  { "ok": true }
 * Firestore:      messages.readByAgent + unreadForAgent cleared on parent doc
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { agentMarkConversationRead } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/:conversationId/read
 * Clears the agent-side unread counter for this conversation.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;

  try {
    await agentMarkConversationRead(auth.uid, conversationId);
    return chatJson({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not mark read.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
