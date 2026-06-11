/**
 * CC direct chat — agent closes a session.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/cc-direct/agent/{chatId}/close
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:  { "ok": true }
 * Effect:         sessionStatus → closed; owner messages blocked until agent reopens
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { closeCcRoom } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/cc-direct/agent/:chatId/close
 * Ends the CC direct session from the agent side.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { chatId } = await context.params;

  try {
    await closeCcRoom(chatId, auth.uid);
    return chatJson({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not close chat.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
