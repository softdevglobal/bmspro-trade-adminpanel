/**
 * Support chat — agent sets online/offline presence.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/presence
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "online": true }
 *
 * Success — 200:  { "ok": true }
 * Firestore:      call_center_agents/{uid}.isOnline
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { setAgentPresence } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/presence
 * Call when the agent app opens/closes so queue messages can fan-out via FCM.
 */
export async function POST(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return chatJson({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const online: boolean =
    !!(
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { online?: unknown }).online === true
    );

  await setAgentPresence(auth.uid, online);
  return chatJson({ ok: true });
}
