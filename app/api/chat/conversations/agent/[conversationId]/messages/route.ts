/**
 * Support chat — agent loads and sends messages on a claimed conversation.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET  http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages?limit=40&before={messageId}
 * POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 *
 * POST body:  { "message": "Hi, how can I help?" }
 * GET query:  limit (default 40), before (pagination cursor)
 *
 * POST success — 200:  { "ok": true, "messageId": "..." }
 * GET success  — 200:  { "ok": true, "messages": [...] }
 *
 * Requires agent to have claimed the conversation first.
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import {
  agentSendMessage,
  getConversationMessages,
} from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/conversations/agent/:conversationId/messages
 * Paginated message history for an assigned conversation.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "40");
  const before = url.searchParams.get("before");

  const messages = await getConversationMessages(
    conversationId,
    Number.isFinite(limit) ? limit : 40,
    before,
  );

  return chatJson({ ok: true, messages });
}

/**
 * POST /api/chat/conversations/agent/:conversationId/messages
 * Agent reply — owner sees it in the dashboard chat widget via Firestore.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { conversationId } = await context.params;

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
    const result = await agentSendMessage(auth.uid, conversationId, message);
    return chatJson({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not send message.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
