/**
 * Support chat — agent registers FCM push token.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/conversations/agent/fcm-token
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "token": "<fcm_device_token>", "platform": "android" }
 *
 * Success — 200:  { "ok": true }
 * Errors:         400 if token missing
 * Firestore:      call_center_agents/{uid}.fcmToken
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { chatJson, chatOptions } from "@/lib/chat/cors";
import { registerAgentFcmToken } from "@/lib/chat/supportChat";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/conversations/agent/fcm-token
 * Stores the agent device token for incoming chat push notifications.
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

  const token =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { token?: unknown }).token === "string"
      ? (body as { token: string }).token.trim()
      : "";
  const platform =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { platform?: unknown }).platform === "string"
      ? (body as { platform: string }).platform
      : null;

  if (!token) {
    return chatJson({ ok: false, error: "FCM token is required." }, { status: 400 });
  }

  await registerAgentFcmToken(auth.uid, token, platform);
  return chatJson({ ok: true });
}
