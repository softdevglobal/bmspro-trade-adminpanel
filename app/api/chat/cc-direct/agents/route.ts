/**
 * CC direct chat — owner lists available call-center agents.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/cc-direct/agents
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "agents": [{ "id", "fullName", "email", "isOnline" }] }
 *
 * Use agent id when opening a direct room: POST /api/chat/cc-direct/rooms
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { listActiveCcAgents } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/agents
 * Returns active call-center agents the owner can start a 1:1 chat with.
 */
export async function GET(request: Request) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const agents = await listActiveCcAgents();
  return chatJson({ ok: true, agents });
}
