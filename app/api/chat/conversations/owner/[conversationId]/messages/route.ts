/**
 * Support chat — workshop owner loads message history for their conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/conversations/owner/{conversationId}/messages?limit=100
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 * Query:    limit (default 100, max 200)
 *
 * Success — 200:  { "ok": true, "messages": [...] }
 * Errors:         403 access denied, 400 conversation not found
 *
 * Used by: dashboard chat widget (components/support-chat-widget.tsx)
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { customerGetConversationMessages } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/conversations/owner/:conversationId/messages
 * Returns chronological message history for the owner's conversation.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");

  try {
    const messages = await customerGetConversationMessages(
      auth.uid,
      conversationId,
      Number.isFinite(limit) ? limit : 100,
    );
    return chatJson({ ok: true, messages });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Could not load messages.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
