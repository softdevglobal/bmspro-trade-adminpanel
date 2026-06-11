/**
 * Support chat — agent transfers conversation to another agent.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/transfer
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "targetAgentUid": "other_agent_firebase_uid" }
 *
 * Success — 200:  { "ok": true }
 * Errors:         400 cannot transfer to yourself / not assigned
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { agentTransferConversation } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/:conversationId/transfer
 * Reassigns the thread to another call-center agent.
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

  const targetAgentUid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { targetAgentUid?: unknown }).targetAgentUid === "string"
      ? (body as { targetAgentUid: string }).targetAgentUid.trim()
      : "";

  if (!targetAgentUid) {
    return chatJson(
      { ok: false, error: "targetAgentUid is required." },
      { status: 400 },
    );
  }

  try {
    await agentTransferConversation(auth.uid, conversationId, targetAgentUid);
    return chatJson({ ok: true });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Could not transfer conversation.";
    const status = msg === "Access denied." ? 403 : 400;
    return chatJson({ ok: false, error: msg }, { status });
  }
}
