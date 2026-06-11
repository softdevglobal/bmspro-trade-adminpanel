/**
 * CC direct chat — agent gets room metadata.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/cc-direct/agent/{chatId}
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:  { "ok": true, "room": { "chatId", "tenantName", "sessionStatus", ... } }
 * Errors:         404 chat not found
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { getCcChat } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/agent/:chatId
 * Returns CC room details for the agent inbox / thread header.
 */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { chatId } = await context.params;
  const room = await getCcChat(chatId);

  if (!room) {
    return chatJson({ ok: false, error: "Chat not found." }, { status: 404 });
  }

  return chatJson({ ok: true, room });
}
