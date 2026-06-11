/**
 * CC direct chat — agent loads and sends messages in a room.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET  http://localhost:3000/api/chat/cc-direct/agent/{chatId}/messages?limit=40&before={messageId}
 * POST http://localhost:3000/api/chat/cc-direct/agent/{chatId}/messages
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 *
 * POST body:  { "text": "How can I help?" }
 * GET query:  limit (default 40), before (pagination cursor)
 *
 * POST success — 200:  { "ok": true, "messageId": "..." }
 * GET success  — 200:  { "ok": true, "messages": [...] }
 *
 * Reopening: agent POST on a closed session automatically sets sessionStatus → open
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
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
 * GET /api/chat/cc-direct/agent/:chatId/messages
 * Paginated CC message history for the agent.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
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
 * POST /api/chat/cc-direct/agent/:chatId/messages
 * Agent reply — owner sees it in the dashboard chat widget via Firestore.
 */
export async function POST(request: Request, context: RouteContext) {
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
      "call_center",
      text,
    );
    return chatJson({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not send message.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
