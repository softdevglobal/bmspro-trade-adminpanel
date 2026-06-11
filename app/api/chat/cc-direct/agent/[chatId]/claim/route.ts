/**
 * CC direct chat — agent claims a pending queue request.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/cc-direct/agent/{chatId}/claim
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:  { "ok": true, "room": { "queueStatus": "active", "agentUid", ... } }
 * Errors:         400 if chat is not in pending queue state
 *
 * Do this after: GET /api/chat/cc-direct/agent (copy chatId from queue array)
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { claimCcQueueChat } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/cc-direct/agent/:chatId/claim
 * Assigns a pending CC queue chat to the calling agent.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { chatId } = await context.params;

  try {
    const room = await claimCcQueueChat(auth.uid, chatId);
    return chatJson({ ok: true, room });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not claim chat.";
    return chatJson({ ok: false, error: msg }, { status: 400 });
  }
}
