/**
 * Support chat — agent closes a conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/close
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "farewellMessage": "Thanks for contacting us!" }  (optional)
 *
 * Success — 200:  { "ok": true }
 * Effect:         status → closed; owner's next message starts a new conversation
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { agentCloseConversation } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/:conversationId/close
 * Ends the support session and optionally sends a farewell message.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;

  let farewellMessage: string | null = null;
  try {
    const body = await request.json();
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { farewellMessage?: unknown }).farewellMessage === "string"
    ) {
      farewellMessage = (body as { farewellMessage: string }).farewellMessage;
    }
  } catch {
    /* optional body */
  }

  try {
    await agentCloseConversation(auth.uid, conversationId, farewellMessage);
    return chatJson({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not close conversation.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
