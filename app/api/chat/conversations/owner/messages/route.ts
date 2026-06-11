/**
 * Support chat — workshop owner sends a message to the reception queue.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/owner/messages
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 * Body:    { "message": "Hello, I need help" }
 *
 * Success — 200:
 *   { "ok": true, "conversationId": "abc123", "messageId": "msg456", "created": true }
 *
 * Errors:
 *   { "ok": false, "error": "Workshop chat access required." }     403
 *   { "ok": false, "error": "Message is required." }               400
 *
 * Firestore: conversations/{conversationId}/messages/{messageId}
 * Used by:   dashboard chat widget (components/support-chat-widget.tsx)
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { customerSendMessage } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

/** CORS preflight for cross-origin clients. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/owner/messages
 * Creates or reuses an open conversation and appends an owner message.
 */
export async function POST(request: Request) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return chatJson({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const message =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : "";

  try {
    const result = await customerSendMessage(auth.uid, message);
    return chatJson({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not send message.";
    return chatJson({ ok: false, error: msg }, { status: 400 });
  }
}
