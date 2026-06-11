/**
 * CC direct chat — owner loads and sends messages in a room.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET  http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/messages?limit=40&before={messageId}
 * POST http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/messages
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 *
 * POST body:  { "text": "Hello" }
 * GET query:  limit (default 40), before (pagination cursor)
 *
 * POST success — 200:  { "ok": true, "messageId": "..." }
 * Errors:             409 if sessionStatus is closed
 *
 * Firestore: cc_direct_chats/{chatId}/messages/{messageId}
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import {
  appendCcDirectMessage,
  getCcMessages,
} from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/rooms/:chatId/messages
 * Paginated CC message history for the owner.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { chatId } = await context.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "40");
  const before = url.searchParams.get("before");

  const messages = await getCcMessages(
    chatId,
    Number.isFinite(limit) ? limit : 40,
    before,
  );

  return chatJson({ ok: true, messages });
}

/**
 * POST /api/chat/cc-direct/rooms/:chatId/messages
 * Owner sends a message; pushes FCM notification to the assigned agent.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireWorkshopChatUser(request);
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

  const text =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text
      : "";

  try {
    const result = await appendCcDirectMessage(
      chatId,
      auth.uid,
      auth.role,
      text,
    );
    return chatJson({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not send message.";
    const status =
      msg === "Access denied." ? 403 : msg === "This chat session is closed." ? 409 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
