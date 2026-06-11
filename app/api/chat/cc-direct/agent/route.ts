/**
 * CC direct chat — agent lists assigned threads and queue.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/cc-direct/agent?limit=50
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Query:   limit (default 50)
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "assigned": [...], "queue": [...] }
 *
 * Next step for queue items: POST /api/chat/cc-direct/agent/{chatId}/claim
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { listAgentCcChats } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/agent
 * Returns open CC threads assigned to this agent plus pending queue requests.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const result = await listAgentCcChats(
    auth.uid,
    Number.isFinite(limit) ? limit : 50,
  );

  return chatJson({ ok: true, ...result });
}
