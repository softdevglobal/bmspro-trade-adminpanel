/**
 * Support chat — workshop owner gets their current/open conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/conversations/owner
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "conversation": { "conversationId", "status", "lastMessage", ... } | null }
 *
 * Errors:
 *   { "ok": false, "error": "Workshop chat access required." }     403
 *
 * Firestore: conversations (where userId == uid)
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { getCustomerConversation } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/conversations/owner
 * Returns the owner's active (waiting/connected) conversation.
 */
export async function GET(request: Request) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const conversation = await getCustomerConversation(auth.uid);
  return chatJson({ ok: true, conversation });
}
