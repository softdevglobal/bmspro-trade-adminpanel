/**
 * Support chat — workshop owner marks agent messages as read.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/owner/{conversationId}/read
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 * Body:    none
 *
 * Success — 200:  { "ok": true }
 * Errors:         403 access denied, 400 conversation not found
 *
 * Firestore: updates messages.readByCustomer + unreadForCustomer on parent doc
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { markCustomerConversationRead } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/owner/:conversationId/read
 * Clears unread badge when the owner opens the chat panel.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;

  try {
    await markCustomerConversationRead(auth.uid, conversationId);
    return chatJson({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not mark read.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
