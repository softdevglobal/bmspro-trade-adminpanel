/**
 * Support chat — agent lists queue and assigned conversations.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/conversations/agent?queueLimit=30&mineLimit=30
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_or_super_admin_id_token>
 * Query:   queueLimit (default 30), mineLimit (default 30)
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "queue": [...], "mine": [...] }
 *
 * Errors:
 *   { "ok": false, "error": "Call-center or super admin access required." }  403
 *
 * Next step after owner sends: claim with POST .../agent/{conversationId}/claim
 * 
 * 
 * Agent login
POST http://localhost:3000/api/callcenter/auth/login

See the queue
GET http://localhost:3000/api/chat/conversations/agent
(use agent idToken as Bearer)

Claim the conversation
POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/claim

Reply
POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages
Body: { "message": "Hi, how can I help?" }

The owner should see the reply in the chat widget in real time.
 * 
 * 
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { listAgentConversations } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/conversations/agent
 * Returns waiting queue threads and conversations assigned to this agent.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const queueLimit = Number(url.searchParams.get("queueLimit") ?? "30");
  const mineLimit = Number(url.searchParams.get("mineLimit") ?? "30");

  const result = await listAgentConversations(
    auth.uid,
    Number.isFinite(queueLimit) ? queueLimit : 30,
    Number.isFinite(mineLimit) ? mineLimit : 30,
  );

  return chatJson({ ok: true, ...result });
}
